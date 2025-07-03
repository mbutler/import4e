import { lookup } from "../tools/lookup_tables.js"
import { 
  parseLanguages,
  parseVision, 
  isRitualName 
} from "./importerHelpers.js"
import {
  getDetails,
  getSkills,
  getRulesElements,
  getPowerNames,
  getClassFeatures
} from './xmlParsing.js'
import {
  fetchItems,
  fetchRituals,
  importRitual,
  fetchSpecialItems,
  fetchHeritageFeatures
} from './compendiumLookup.js'
import {
  fetchEquipment,
  importCompositeItem
} from './equipmentHelpers.js'
import {
  fetchPowers,
  fetchCorePowers
} from './powerHelpers.js'

export class ImporterApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "importer-app",
      title: "D&D 4E Character Importer",
      template: "modules/import4e/templates/importer-dialog.hbs",
      classes: ["dnd4e", "importer"],
      width: 450,
      height: 180,
      closeOnSubmit: false
    })
  }

  constructor(...args) {
    super(...args)
    this._xmlText = null
    this._progress = 0
    this._progressMessage = ""
  }

  async getData() {
    return {
      hint1: "Choose a .dnd4e file to import.",
      hint2: "Click Import to create the character.",
      hint3: "This imports feats, features, powers, level, class, race, and abilities.",
      progress: this._progress,
      progressMessage: this._progressMessage,
      importCorePowers: true
    }
  }

  activateListeners(html) {
    super.activateListeners(html)
    html.find("input[type='file']").on("change", async event => {
      const file = event.target.files[0]
      if (!file) return
      this._xmlText = await file.text()
      ui.notifications.info(`Loaded file: ${file.name}`)
    })
  }

  _setProgress(percent, message) {
    this._progress = percent
    this._progressMessage = message
    this.render(false)
  }

  async _updateObject(event, formData) {
    if (!this._xmlText) {
      ui.notifications.error("No file selected.")
      return
    }

    const importCorePowers = formData.importCorePowers !== undefined ? formData.importCorePowers : true

    try {
      this._setProgress(5, "Parsing XML file...")
      const parser = new DOMParser()
      const xml = parser.parseFromString(this._xmlText, "text/xml")

      const details = getDetails(xml)
      if (!details.name) {
        this._setProgress(0, "")
        ui.notifications.error("Parsed character name was empty — aborting import.")
        return
      }

      // Parse languages for system.languages (spoken/script/custom)
      const languageNames = Object.values(getRulesElements(xml, "Language"))
      const parsedLanguages = parseLanguages(languageNames, lookup)

      // Parse vision for system.senses.special.value
      const visionNames = Object.values(getRulesElements(xml, "Vision"))
      const parsedVision = parseVision(visionNames, lookup)

      this._setProgress(10, "Importing feats...")
      const featNames = Object.values(getRulesElements(xml, "Feat"))
      const feats = await fetchItems("dnd-4e-compendium.module-feats", featNames, lookup.feat, true)

      this._setProgress(15, "Importing racial features...")
      const heritageFeatures = await fetchHeritageFeatures(xml)

      this._setProgress(25, "Importing features...")
      let featureNames = getClassFeatures(xml)
      // Always include the canonical class feature for the character's class
      const canonicalClassFeature = lookup.class?.[details.class]
      if (canonicalClassFeature && !featureNames.includes(canonicalClassFeature)) {
        featureNames = [...featureNames, canonicalClassFeature]
      }

      // Filter features by character level
      const levelRegex = /(\d+)(st|nd|rd|th) level/i
      featureNames = featureNames.filter(name => {
        const match = name.match(levelRegex)
        if (match) {
          const requiredLevel = parseInt(match[1], 10)
          return requiredLevel <= details.level
        }
        return true // If no level requirement, always include
      })

      // Split features: canonical class feature vs. others
      const classFeatureNames = canonicalClassFeature ? [canonicalClassFeature] : []
      const otherFeatureNames = featureNames.filter(n => n !== canonicalClassFeature)

      // Fetch canonical class feature from classes compendium
      let classFeatureItems = []
      if (classFeatureNames.length > 0) {
        classFeatureItems = await fetchItems("dnd-4e-compendium.module-classes", classFeatureNames, lookup.feature, true)
      }
      // Fetch other features from features compendium
      const otherFeatureItems = await fetchItems("dnd-4e-compendium.module-features", otherFeatureNames, lookup.feature, true)

      // Merge
      let features = [...classFeatureItems, ...otherFeatureItems]

      // Also import Paragon Path, Epic Destiny, and Theme entries themselves
      const extraFeatureItems = []
      if (details.paragonPath) {
        const pathItems = await fetchItems("dnd-4e-compendium.module-paths", [details.paragonPath], lookup.path, true)
        extraFeatureItems.push(...pathItems)
      }
      if (details.epicDestiny) {
        const destinyItems = await fetchItems("dnd-4e-compendium.module-destinies", [details.epicDestiny], lookup.destiny, true)
        extraFeatureItems.push(...destinyItems)
      }
      if (details.theme) {
        const themeItems = await fetchItems("dnd-4e-compendium.module-themes", [details.theme], lookup.theme, true)
        extraFeatureItems.push(...themeItems)
      }
      if (details.background) {
        const backgroundItems = await fetchItems("dnd-4e-compendium.module-backgrounds", [details.background], lookup.background, true)
        extraFeatureItems.push(...backgroundItems)
      }
      features = [...features, ...extraFeatureItems]

      this._setProgress(60, "Importing equipment...")
      const equipment = await fetchEquipment(xml, importCompositeItem, isRitualName)

      this._setProgress(35, "Importing powers...")
      let powerNames = getPowerNames(xml)
      const powers = await fetchPowers(powerNames, details.class, details.classes, equipment, feats, features, details.level)

      this._setProgress(50, "Importing core powers...")
      const corePowersAll = await fetchCorePowers(details.classes, equipment, feats, features, details.level)
      let corePowers = []
      if (importCorePowers) {
        corePowers = corePowersAll
      } else {
        const exceptions = [
          "Melee Basic Attack",
          "Ranged Basic Attack",
          "Ranged Basic Attack Heavy Thrown"
        ]
        corePowers = corePowersAll.filter(p => exceptions.includes(p.name))
      }

      this._setProgress(70, "Importing rituals...")
      const rituals = await fetchRituals(xml, importRitual, isRitualName)

      this._setProgress(80, "Importing special items...")
      const specialItems = await fetchSpecialItems(xml, fetchItems)

      this._setProgress(90, "Finalizing import...")
      // Final deduplication pass across all categories
      const allItems = [...feats, ...heritageFeatures, ...features, ...powers, ...corePowers, ...equipment, ...rituals, ...specialItems]
      const finalItems = this._deduplicateFinalItems(allItems)

      this._setProgress(95, "Creating actor...")
      
      // Parse skills from XML
      const skills = getSkills(xml)
      
      // Create actor with correct values
      const actor = await Actor.create({
        name: details.name,
        type: "Player Character",
        system: {
          details: {
            level: details.level,
            class: details.class,
            race: details.race,
            subrace: details.subrace,
            paragon: details.paragonPath,
            epic: details.epicDestiny,
            background: details.background,
            theme: details.theme,
            deity: details.deity,
            vision: details.vision,
            gender: details.gender,
            alignment: details.alignment,
            age: details.age,
            height: details.height,
            weight: details.weight,
            size: details.size,
            weaponProf: { value: details.weaponProficiencies },
            armourProf: { value: details.armorProficiencies },
            currency: details.currency,
            company: 'Hexcom',
            surges: {
              value: details.healingSurges.current,
              max: details.healingSurges.maximum
            },
            exp: Number(details.exp) || 0
          },
          abilities: {
            str: { value: details.abilities.str },
            con: { value: details.abilities.con },
            dex: { value: details.abilities.dex },
            int: { value: details.abilities.int },
            wis: { value: details.abilities.wis },
            cha: { value: details.abilities.cha }
          },
          defences: {
            ac: {
              absolute: details.defenses.ac
            },
            fort: {
              absolute: details.defenses.fortitude
            },
            ref: {
              absolute: details.defenses.reflex
            },
            wil: {
              absolute: details.defenses.will
            }
          },
          attributes: {
            hp: {
              value: details.hitPoints.current,
              max: details.hitPoints.maximum
            },
            init: { value: details.initiative },
            speed: { value: details.speed }
          },
          actionpoints: { value: details.actionPoints },
          skills: skills,
          skillTraining: {
            untrained: {
              value: 0,
              feat: 0,
              item: 0,
              power: 0,
              untyped: 0
            },
            trained: {
              value: 5,
              feat: 0,
              item: 0,
              power: 0,
              untyped: 0
            },
            expertise: {
              value: 8,
              feat: 0,
              item: 0,
              power: 0,
              untyped: 0
            }
          },
          languages: parsedLanguages,
          senses: {
            special: { value: parsedVision }
          }
        }
      })
      
      // Import items normally
      await actor.createEmbeddedDocuments("Item", finalItems)
      
      // Post-import: Check and fix skill values
      const skillUpdates = []
      for (const [skillId, skill] of Object.entries(actor.system.skills)) {
        if (skill.absolute !== undefined && skill.absolute !== null) {
          if (skill.total !== skill.absolute) {
            skillUpdates.push({
              [`system.skills.${skillId}.total`]: skill.absolute
            })
          }
        }
      }
      
      if (skillUpdates.length > 0) {
        await actor.update(skillUpdates)
      }
      
      // Post-import: Ensure equipped status is correct for items that were explicitly set
      const equippedStatusUpdates = []
      for (const item of actor.items) {
        if (item.flags?.import4e?.equippedStatusSet) {
          const expectedStatus = item.flags.import4e.originalEquippedStatus
          if (item.system.equipped !== expectedStatus) {
            equippedStatusUpdates.push({
              _id: item.id,
              "system.equipped": expectedStatus
            })
          }
        }
      }
      
      if (equippedStatusUpdates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", equippedStatusUpdates)
      }
      
      // Apply character-specific patches (ultimate override)
      await this._applyCharacterPatches(actor, details.name)
      
      this._setProgress(100, "Import complete!")
      ui.notifications.info(`Imported ${details.name} with ${finalItems.length} total items (${feats.length} feats, ${features.length} features, ${powers.length} powers, ${corePowers.length} core powers, ${equipment.length} equipment, ${rituals.length} rituals, ${specialItems.length} special items).`)
      setTimeout(() => {
        this.close(); // Close the dialog after import is complete (no setProgress after)
      }, 2000)
    } catch (err) {
      this._setProgress(0, "")
      console.error(err)
      ui.notifications.error("Failed to import character.")
    }
  }

  _deduplicateFinalItems(allItems) {
    const finalItems = []
    const seenNames = new Set()
    const seenIds = new Set()

    for (const item of allItems) {
      // Check for duplicates by both name and any existing ID
      const isDuplicate = seenNames.has(item.name) || 
                         (item._id && seenIds.has(item._id)) ||
                         (item.flags?.import4e?.placeholder && seenNames.has(item.name))

      if (!isDuplicate) {
        finalItems.push(item)
        seenNames.add(item.name)
        if (item._id) seenIds.add(item._id)
      }
    }

    return finalItems
  }

  async _applyCharacterPatches(actor, characterName) {
    try {
      const patchData = await this._loadCharacterPatch(characterName)
      if (!patchData) {
        return // No patch file found, nothing to do
      }

      console.log(`Applying patches for character: ${characterName}`)

      // Apply actor-level patches with validation
      if (patchData.actor && Object.keys(patchData.actor).length > 0) {
        const actorUpdates = {}
        for (const [path, value] of Object.entries(patchData.actor)) {
          if (this._pathExists(actor, path)) {
            actorUpdates[path] = value
            console.log(`  ✓ Applying actor patch: ${path} = ${value}`)
          } else {
            console.warn(`  ✗ Patch path not found: ${path}`)
          }
        }
        
        if (Object.keys(actorUpdates).length > 0) {
          console.log(`  Applying ${Object.keys(actorUpdates).length} actor patches`)
          await actor.update(actorUpdates)
        }
      }

      // Apply item-level patches with validation
      if (patchData.items && Object.keys(patchData.items).length > 0) {
        const itemUpdates = []
        
        for (const [itemName, itemPatches] of Object.entries(patchData.items)) {
          // Find items by name (case-insensitive)
          const items = actor.items.filter(i => 
            i.name.toLowerCase() === itemName.toLowerCase()
          )
          
          if (items.length === 0) {
            console.warn(`  ✗ Item not found for patching: ${itemName}`)
            continue
          } else if (items.length > 1) {
            console.warn(`  ⚠ Multiple items found with name "${itemName}", applying to first match`)
          }
          
          const item = items[0]
          const itemUpdate = { _id: item.id }
          let validPatches = 0
          
          for (const [path, value] of Object.entries(itemPatches)) {
            if (this._pathExists(item, path)) {
              itemUpdate[path] = value
              console.log(`  ✓ Applying item patch: ${itemName}.${path} = ${value}`)
              validPatches++
            } else {
              console.warn(`  ✗ Item patch path not found: ${itemName}.${path}`)
            }
          }
          
          if (validPatches > 0) {
            itemUpdates.push(itemUpdate)
          }
        }
        
        if (itemUpdates.length > 0) {
          console.log(`  Applying ${itemUpdates.length} item patches`)
          await actor.updateEmbeddedDocuments("Item", itemUpdates)
        }
      }

      console.log(`Patches applied successfully for ${characterName}`)
    } catch (err) {
      console.error(`Error applying patches for ${characterName}:`, err)
      ui.notifications.warn(`Warning: Failed to apply character patches for ${characterName}`)
    }
  }

  _pathExists(obj, path) {
    const keys = path.split('.')
    let current = obj
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        return false
      }
    }
    
    return true
  }

  async _loadCharacterPatch(characterName) {
    // Try multiple filename variations for the patch file
    const possibleFilenames = [
      `${characterName}.json`,
      `${characterName.toLowerCase()}.json`,
      `${this._normalizeCharacterName(characterName)}.json`
    ]

    for (const filename of possibleFilenames) {
      try {
        // Use the module's file system path
        const patchPath = `modules/import4e/patches/${filename}`
        const response = await fetch(patchPath)
        if (response.ok) {
          const patchData = await response.json()
          console.log(`Loaded patch file: ${patchPath}`)
          return patchData
        }
      } catch (err) {
        // Continue to next filename variation
        continue
      }
    }

    // No patch file found
    return null
  }

  _normalizeCharacterName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .trim()
  }
}
