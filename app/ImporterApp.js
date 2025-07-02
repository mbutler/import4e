import { lookup } from "../tools/lookup_tables.js"

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

      const details = this._getDetails(xml)
      if (!details.name) {
        this._setProgress(0, "")
        ui.notifications.error("Parsed character name was empty — aborting import.")
        return
      }

      this._setProgress(10, "Importing feats...")
      const featNames = Object.values(this._getRulesElements(xml, "Feat"))
      const feats = await this._fetchItems("dnd-4e-compendium.module-feats", featNames, lookup.feat, true)

      this._setProgress(15, "Importing racial features...")
      const heritageFeatures = await this._fetchHeritageFeatures(xml)

      this._setProgress(25, "Importing features...")
      let featureNames = this._getClassFeatures(xml)
      // Always include the canonical class feature for the character's class
      const canonicalClassFeature = lookup.class?.[details.class]
      if (canonicalClassFeature && !featureNames.includes(canonicalClassFeature)) {
        featureNames = [...featureNames, canonicalClassFeature]
      }

      // Split features: canonical class feature vs. others
      const classFeatureNames = canonicalClassFeature ? [canonicalClassFeature] : []
      const otherFeatureNames = featureNames.filter(n => n !== canonicalClassFeature)

      // Fetch canonical class feature from classes compendium
      let classFeatureItems = []
      if (classFeatureNames.length > 0) {
        classFeatureItems = await this._fetchItems("dnd-4e-compendium.module-classes", classFeatureNames, lookup.feature, true)
      }
      // Fetch other features from features compendium
      const otherFeatureItems = await this._fetchItems("dnd-4e-compendium.module-features", otherFeatureNames, lookup.feature, true)

      // Merge
      const features = [...classFeatureItems, ...otherFeatureItems]

      this._setProgress(35, "Importing powers...")
      let powerNames = this._getPowerNames(xml)
      const powers = await this._fetchPowers(powerNames, details.class, details.classes)

      this._setProgress(50, "Importing core powers...")
      const corePowersAll = await this._fetchCorePowers(details.classes)
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

      this._setProgress(60, "Importing equipment...")
      const equipment = await this._fetchEquipment(xml)

      this._setProgress(70, "Importing rituals...")
      const rituals = await this._fetchRituals(xml)

      this._setProgress(80, "Importing special items...")
      const specialItems = await this._fetchSpecialItems(xml, details)

      this._setProgress(90, "Finalizing import...")
      // Final deduplication pass across all categories
      const allItems = [...feats, ...heritageFeatures, ...features, ...powers, ...corePowers, ...equipment, ...rituals, ...specialItems]
      const finalItems = this._deduplicateFinalItems(allItems)

      this._setProgress(95, "Creating actor...")
      
      // Parse skills from XML
      const skills = this._getSkills(xml)
      
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
            languages: details.languages,
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
      
      this._setProgress(100, "Import complete!")
      ui.notifications.info(`Imported ${details.name} with ${finalItems.length} total items (${feats.length} feats, ${features.length} features, ${powers.length} powers, ${corePowers.length} core powers, ${equipment.length} equipment, ${rituals.length} rituals, ${specialItems.length} special items).`)
      setTimeout(() => { this._setProgress(0, "") }, 2000)
    } catch (err) {
      this._setProgress(0, "")
      console.error(err)
      ui.notifications.error("Failed to import character.")
    }
  }

  _getDetails(xml) {
    const getText = tag => xml.querySelector(`Details > ${tag}`)?.textContent?.trim() || ""
    const getStat = alias => {
      // Try multiple possible alias names for each stat
      const aliases = Array.isArray(alias) ? alias : [alias]
      for (const aliasName of aliases) {
        const match = xml.querySelector(`Stat > alias[name='${aliasName}']`)
        if (match) {
          const value = Number(match.parentElement.getAttribute("value"))
          return value
        }
      }
      return 10
    }

    // Helper to get all rules elements of a type as an array
    const getRulesArray = (type) => Object.values(this._getRulesElements(xml, type))

    const className = Object.values(this._getRulesElements(xml, "Class"))[0] || ""
    const raceName = Object.values(this._getRulesElements(xml, "Race"))[0] || ""
    const paragonPathName = Object.values(this._getRulesElements(xml, "Paragon Path"))[0] || ""
    const epicDestinyName = Object.values(this._getRulesElements(xml, "Epic Destiny"))[0] || ""
    const subraceName = Object.values(this._getRulesElements(xml, "Subrace"))[0] || ""
    const backgroundName = Object.values(this._getRulesElements(xml, "Background"))[0] || ""
    const themeName = Object.values(this._getRulesElements(xml, "Theme"))[0] || ""
    const deityName = Object.values(this._getRulesElements(xml, "Deity"))[0] || ""
    const visionName = Object.values(this._getRulesElements(xml, "Vision"))[0] || ""
    const languages = getRulesArray("Language")
    const weaponProfs = getRulesArray("Proficiency").filter(p => p.includes("Weapon Proficiency"))
    const armorProfs = getRulesArray("Proficiency").filter(p => p.includes("Armor Proficiency") || p.includes("Shield Proficiency"))

    // Map proficiencies using lookup table
    const weaponProfsMapped = weaponProfs.map(p => {
      const match = p.match(/Weapon Proficiency \((.*)\)/)
      return match ? (lookup.proficiency[match[1]] || match[1]) : p
    })
    const armorProfsMapped = armorProfs.map(p => {
      const match = p.match(/(Armor|Shield) Proficiency \((.*)\)/)
      return match ? (lookup.proficiency[match[2]] || match[2]) : p
    })

    // Map languages using lookup table if available
    const languagesMapped = languages.map(l => lookup.language?.[l] || l)

    // Currency (parse as best as possible)
    const currency = {}
    const moneyFields = ["GP", "SP", "CP"]
    moneyFields.forEach(type => {
      const value = getStat(type)
      if (value && !isNaN(value)) currency[type.toLowerCase()] = value
    })

    // Other details
    const gender = getText("Gender")
    const alignment = getText("Alignment")
    const age = getText("Age")
    const height = getText("Height")
    const weight = getText("Weight")
    const size = getText("Size") || getText("size")

    return {
      name: getText("name") || "Unnamed Character",
      level: Number(getText("Level")) || 1,
      class: className,
      classes: className === "Hybrid" ? Object.values(this._getRulesElements(xml, "Hybrid Class")).map(c => c.replace("Hybrid ", "")) : [className],
      race: raceName,
      subrace: subraceName,
      paragonPath: paragonPathName,
      epicDestiny: epicDestinyName,
      background: backgroundName,
      theme: themeName,
      deity: deityName,
      vision: visionName,
      gender,
      alignment,
      age,
      height,
      weight,
      size,
      weaponProficiencies: weaponProfsMapped,
      armorProficiencies: armorProfsMapped,
      languages: languagesMapped,
      currency,
      abilities: {
        str: getStat("str"),
        con: getStat("con"),
        dex: getStat("dex"),
        int: getStat("int"),
        wis: getStat("wis"),
        cha: getStat("cha")
      },
      defenses: {
        ac: getStat(["AC", "Armor Class"]),
        fortitude: getStat(["Fortitude Defense", "Fortitude"]),
        reflex: getStat(["Reflex Defense", "Reflex"]),
        will: getStat(["Will Defense", "Will"])
      },
      hitPoints: {
        current: getStat("Hit Points"),
        maximum: getStat("Hit Points")
      },
      healingSurges: {
        current: getStat("Healing Surges"),
        maximum: getStat("Healing Surges"),
        value: getStat("Healing Surges")
      },
      initiative: getStat("Initiative"),
      speed: getStat("Speed") || 6,
      actionPoints: getStat("_BaseActionPoints") || 1,
      exp: Number(getText("Experience")) || 0
    }
  }

  _getSkills(xml) {
    const skills = {}
    
    // Get all skill stats from StatBlock (the source of truth)
    xml.querySelectorAll('StatBlock > Stat').forEach(stat => {
      const alias = stat.querySelector('alias')
      if (!alias) return
      
      const skillName = alias.getAttribute('name')
      const skillValue = Number(stat.getAttribute('value')) || 0
      
      // Check if this is a main skill (not a training or misc bonus)
      if (skillName && !skillName.includes(' Trained') && !skillName.includes(' Misc') && !skillName.includes(' Penalty')) {
        // Map skill names to D&D 4E system skill IDs
        const skillId = this._mapSkillNameToId(skillName)
        if (skillId) {
          // Get the ability associated with this skill
          const ability = this._getSkillAbility(skillName)
          
          // Check if this skill is trained
          const isTrained = xml.querySelector(`RulesElementTally > RulesElement[type="Skill Training"][name="${skillName}"]`) !== null
          
          skills[skillId] = {
            value: 0, // Base value (usually 0)
            base: 0, // Base bonus
            training: isTrained ? 5 : 0, // 5=trained, 0=untrained
            ability: ability, // Which ability this skill uses
            absolute: skillValue, // Override calculated value with XML value (as a number)
            total: skillValue, // Also set total directly
            bonus: [{}], // Empty bonus array
            chat: `@name uses @label.`, // Default chat message
            armourCheck: this._isArmorCheckSkill(skillName), // Whether armor check penalty applies
            feat: 0, // Feat bonus
            item: 0, // Item bonus
            power: 0, // Power bonus
            untyped: 0, // Untyped bonus
            effectBonus: 0 // Effect bonus
          }
        }
      }
    })
    
    return skills
  }

  _mapSkillNameToId(skillName) {
    // Map skill names to D&D 4E system skill IDs (matching legacy importer)
    const skillMap = {
      'Acrobatics': 'acr',
      'Arcana': 'arc',
      'Athletics': 'ath',
      'Bluff': 'blu',
      'Diplomacy': 'dip',
      'Dungeoneering': 'dun',
      'Endurance': 'end',
      'Heal': 'hea',
      'Healing': 'hea',
      'History': 'his',
      'Insight': 'ins',
      'Intimidate': 'itm',
      'Nature': 'nat',
      'Perception': 'prc',
      'Religion': 'rel',
      'Stealth': 'stl',
      'Streetwise': 'stw',
      'Thievery': 'thi'
    }
    
    return skillMap[skillName] || null
  }

  _getSkillAbility(skillName) {
    // Map skills to their associated abilities
    const abilityMap = {
      'Acrobatics': 'dex',
      'Arcana': 'int',
      'Athletics': 'str',
      'Bluff': 'cha',
      'Diplomacy': 'cha',
      'Dungeoneering': 'wis',
      'Endurance': 'con',
      'Heal': 'wis',
      'History': 'int',
      'Insight': 'wis',
      'Intimidate': 'cha',
      'Nature': 'wis',
      'Perception': 'wis',
      'Religion': 'int',
      'Stealth': 'dex',
      'Streetwise': 'cha',
      'Thievery': 'dex'
    }
    
    return abilityMap[skillName] || 'str'
  }

  _isArmorCheckSkill(skillName) {
    // Skills that have armor check penalties
    const armorCheckSkills = ['Acrobatics', 'Athletics', 'Endurance', 'Stealth', 'Thievery']
    return armorCheckSkills.includes(skillName)
  }

  _getRulesElements(xml, type) {
    const results = {}
    xml.querySelectorAll(`RulesElementTally > RulesElement[type="${type}"]`).forEach(elem => {
      results[elem.getAttribute("charelem")] = elem.getAttribute("name")
    })
    return results
  }

  _getPowerNames(xml) {
    const powers = this._getRulesElements(xml, "Power")
    const powersObsolete = {} // {id: name}
    const powersRetained = [] // [name]

    // Find powers that replace other powers
    xml.querySelectorAll("RulesElement[type='Power'][replaces]").forEach(elem => {
      const obsolete = elem.getAttribute("replaces")
      powersObsolete[obsolete] = powers[obsolete]
    })

    // Filter out obsolete powers and basic attacks
    Object.keys(powers).forEach(id => {
      if (!powersObsolete[id]) {
        const powerName = powers[id]
        // Skip basic attacks (these are system-level abilities)
        if (!this._isBasicAttack(powerName)) {
          powersRetained.push(powerName)
        }
      }
    })

    return powersRetained
  }

  _isBasicAttack(powerName) {
    const basicAttacks = [
      "Melee Basic Attack",
      "Ranged Basic Attack", 
      "Bull Rush Attack",
      "Grab Attack",
      "Opportunity Attack",
      "Second Wind"
    ]
    return basicAttacks.includes(powerName)
  }

  async _fetchPowers(powerNames, className, classes) {
    const pack = game.packs.get("dnd-4e-compendium.module-powers")
    if (!pack) {
      console.warn("Power compendium not found")
      return []
    }

    const index = await pack.getIndex()
    const results = []
    const seenPowers = new Set() // Track seen powers to prevent duplicates
    const seenPowerIds = new Set() // Track by compendium ID for more precise deduplication

    for (const powerName of powerNames) {
      const resolvedName = lookup.power[powerName] || powerName
      let entry = null

      // Try exact match first
      entry = index.find(e => e.name === resolvedName)
      
      if (!entry) {
        // Try pattern matching with class-aware selection
        const pattern = new RegExp(resolvedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
        const matches = index.filter(e => e.name.match(pattern))
        
        if (matches.length > 0) {
          entry = this._selectBestPowerMatch(matches, classes)
        }
      }

      if (!entry) {
        // Try normalized name (remove parentheses)
        const normalizedName = powerName.replace(/\s*\(.*?\)$/, "").trim()
        const pattern = new RegExp(normalizedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
        const matches = index.filter(e => e.name.match(pattern))
        
        if (matches.length > 0) {
          entry = this._selectBestPowerMatch(matches, classes)
        }
      }

      if (!entry) {
        // Try fuzzy matching for typos and variations
        entry = this._findFuzzyPowerMatch(resolvedName, index, classes)
      }

      if (entry) {
        const item = await pack.getDocument(entry._id)
        if (item) {
          // Check for duplicates by both name and compendium ID
          const isDuplicate = seenPowers.has(item.name) || seenPowerIds.has(item._id)
          
          if (!isDuplicate) {
            results.push(item.toObject())
            seenPowers.add(item.name)
            seenPowerIds.add(item._id)
          }
        }
      } else {
        console.warn(`Power not found: ${powerName}`)
      }
    }

    return results
  }

  async _fetchCorePowers(classes) {
    const pack = game.packs.get("dnd-4e-compendium.module-core-powers")
    if (!pack) {
      console.warn("Core power compendium not found")
      return []
    }

    try {
      const allCorePowers = await pack.getDocuments()
      return allCorePowers.map(power => power.toObject())
    } catch (err) {
      console.error("Error fetching core powers:", err)
      return []
    }
  }

  _selectBestPowerMatch(matches, classes) {
    if (matches.length === 1) {
      return matches[0]
    }

    // Sort by name length (longer names are usually more specific)
    matches.sort((a, b) => b.name.length - a.name.length)

    // For hybrid characters, prefer powers that match their classes
    if (classes.length > 1) {
      const classNames = classes.map(c => c.replace("Class", "").replace("Hybrid", "").trim())
      
      // Look for powers that match hybrid classes
      for (const match of matches) {
        if (classNames.some(c => match.name.includes(c))) {
          return match
        }
      }
      
      // If no hybrid-specific power found, prefer non-hybrid versions
      const nonHybrid = matches.find(m => !m.name.includes("Hybrid"))
      if (nonHybrid) {
        return nonHybrid
      }
    } else {
      // For single class, prefer class-specific versions first
      const className = classes[0].replace("Class", "").replace("Hybrid", "").trim()
      const classSpecific = matches.find(m => m.name.includes(className))
      if (classSpecific) {
        return classSpecific
      }
      
      // Then prefer non-hybrid versions
      const nonHybrid = matches.find(m => !m.name.includes("Hybrid"))
      if (nonHybrid) {
        return nonHybrid
      }
    }

    // Fallback to first match
    return matches[0]
  }

  _findFuzzyPowerMatch(powerName, index, classes) {
    // Normalize the power name for comparison
    const normalizedPowerName = powerName
      .toLowerCase()
      .replace(/\s+/g, ' ')  // Normalize spaces
      .replace(/[''`]/g, "'") // Normalize apostrophes
      .trim()

    let bestMatch = null
    let bestScore = 0

    for (const entry of index) {
      const normalizedEntryName = entry.name
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[''`]/g, "'")
        .trim()

      // Calculate similarity score
      const score = this._calculateSimilarity(normalizedPowerName, normalizedEntryName)
      
      if (score > bestScore && score > 0.7) { // 70% similarity threshold
        bestScore = score
        bestMatch = entry
      }
    }

    return bestMatch
  }

  _calculateSimilarity(str1, str2) {
    // Simple Levenshtein distance-based similarity
    const distance = this._levenshteinDistance(str1, str2)
    const maxLength = Math.max(str1.length, str2.length)
    return maxLength > 0 ? (maxLength - distance) / maxLength : 0
  }

  _levenshteinDistance(str1, str2) {
    const matrix = []
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i]
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          )
        }
      }
    }
    
    return matrix[str2.length][str1.length]
  }

  async _fetchItems(packId, names, lookupTable = {}, createPlaceholders = false) {
    const pack = game.packs.get(packId)
    if (!pack) throw new Error(`Compendium not found: ${packId}`)

    const index = await pack.getIndex()
    const results = []
    const seenItems = new Set() // Track seen items to prevent duplicates
    const seenItemIds = new Set() // Track by compendium ID for more precise deduplication

    for (const rawName of names) {
      const resolvedName = lookupTable[rawName] || rawName
      let entry = index.find(e =>
        e.name === resolvedName ||
        e.name.replace(/\s*\(.*?\)/, "").trim() === resolvedName
      )

      // Try pattern matching if exact match fails
      if (!entry) {
        const pattern = new RegExp(resolvedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
        entry = index.find(e => e.name.match(pattern))
      }

      // Try normalized name (remove parentheses)
      if (!entry) {
        const normalizedName = resolvedName.replace(/\s*\(.*?\)/, "").trim()
        const pattern = new RegExp(normalizedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
        entry = index.find(e => e.name.match(pattern))
      }

      if (!entry) {
        if (createPlaceholders) {
          // Create a placeholder item
          const placeholder = this._createPlaceholderItem(rawName, packId)
          if (placeholder && !seenItems.has(placeholder.name)) {
            results.push(placeholder)
            seenItems.add(placeholder.name)
          }
        } else {
          console.warn(`Item not found: ${resolvedName}`)
        }
        continue
      }

      const item = await pack.getDocument(entry._id)
      if (item) {
        // Check for duplicates by both name and compendium ID
        const isDuplicate = seenItems.has(item.name) || seenItemIds.has(item._id)
        
        if (!isDuplicate) {
          results.push(item.toObject())
          seenItems.add(item.name)
          seenItemIds.add(item._id)
        }
      }
    }

    return results
  }

  _createPlaceholderItem(name, packId) {
    // Determine item type based on pack ID
    let itemType = "feat"
    if (packId.includes("features")) itemType = "feature"
    else if (packId.includes("powers")) itemType = "power"
    else if (packId.includes("equipment")) itemType = "equipment"
    else if (packId.includes("rituals")) itemType = "ritual"

    return {
      name: name,
      type: itemType,
      img: "icons/svg/mystery-man.svg",
      system: {
        description: {
          value: `<p><em>Placeholder for: ${name}</em></p><p>This item was not found in the compendium. It will be updated when the compendium is updated and the character is re-imported.</p>`,
          chat: "",
          unidentified: ""
        },
        source: "Placeholder",
        level: 0
      },
      flags: {
        "import4e": {
          "placeholder": true,
          "originalName": name
        }
      }
    }
  }

  async _fetchEquipment(xml) {
    const loot = this._getLoot(xml)
    const results = []
    const seenEquipment = new Set() // Track seen equipment to prevent duplicates

    for (const compositeItem of loot) {
      if (compositeItem.length === 0) continue

      // Skip rituals - they should be handled by _fetchRituals
      const hasRitual = compositeItem.some(item => 
        item.type === "Ritual" || 
        this._isRitualName(item.name)
      )
      if (hasRitual) {
        continue
      }

      try {
        const importedItem = await this._importCompositeItem(compositeItem)
        if (importedItem) {
          // Check for duplicates before adding
          if (!seenEquipment.has(importedItem.name)) {
            results.push(importedItem)
            seenEquipment.add(importedItem.name)
          }
        }
      } catch (err) {
        console.error("Error importing composite item:", err)
      }
    }

    return results
  }

  async _fetchRituals(xml) {
    const loot = this._getLoot(xml)
    const results = []
    const seenRituals = new Set() // Track seen rituals to prevent duplicates

    for (const compositeItem of loot) {
      if (compositeItem.length === 0) continue

      // Check if any component is a ritual
      const hasRitual = compositeItem.some(item => 
        item.type === "Ritual" || 
        this._isRitualName(item.name)
      )

      if (hasRitual) {
        try {
          const importedRitual = await this._importRitual(compositeItem)
          if (importedRitual) {
            // Check for duplicates before adding
            if (!seenRituals.has(importedRitual.name)) {
              results.push(importedRitual)
              seenRituals.add(importedRitual.name)
            }
          }
        } catch (err) {
          console.error("Error importing ritual:", err)
        }
      }
    }

    return results
  }

  _isRitualName(name) {
    const ritualNames = [
      "Comprehend Language", "Comrades' Succor", "Simbul's Conversion", 
      "Magic Circle", "Brew Potion", "Make Whole", "Enchant Magic Item",
      "Linked Portal", "Sending", "Tenser's Floating Disk", "Water Walk"
    ]
    return ritualNames.some(ritualName => name.includes(ritualName))
  }

  async _importRitual(compositeItem) {
    const pack = game.packs.get("dnd-4e-compendium.module-rituals")
    if (!pack) {
      console.warn("Ritual compendium not found")
      return null
    }

    // Find the ritual component
    const ritualComponent = compositeItem.find(item => 
      item.type === "Ritual" || this._isRitualName(item.name)
    )

    if (!ritualComponent) return null

    const resolvedName = lookup.ritual?.[ritualComponent.name] || ritualComponent.name
    const index = await pack.getIndex()
    
    const entry = index.find(e => e.name === resolvedName)
    if (!entry) {
      console.warn(`Ritual not found: ${resolvedName}`)
      return null
    }

    const ritual = await pack.getDocument(entry._id)
    if (ritual) {
      const ritualObj = ritual.toObject()
      ritualObj.system.quantity = Number(ritualComponent.count) || 1
      
      // Set equipped status based on equip-count from XML
      const equipCount = Number(ritualComponent.equipCount) || 0
      const shouldBeEquipped = equipCount > 0
      ritualObj.system.equipped = shouldBeEquipped
      
      // Ensure the equipped status is correctly set
      if (ritualObj.system.equipped !== shouldBeEquipped) {
        console.warn(`  ⚠️ Equipped status mismatch for ritual ${ritual.name}: expected ${shouldBeEquipped}, got ${ritualObj.system.equipped}`)
        ritualObj.system.equipped = shouldBeEquipped
      }
      
      return ritualObj
    }

    return null
  }

  _getLoot(xml) {
    const elements = []

    const allLootElements = xml.querySelectorAll("LootTally > loot")
    
    allLootElements.forEach((loot, index) => {
      const count = loot.getAttribute("count")
      const equipCount = loot.getAttribute("equip-count")
      
      if (count !== "0") {
        const components = this._getLootComponents(loot)
        if (components.length > 0) {
          elements.push(components)
        }
      }
    })

    return elements
  }

  _getLootComponents(loot) {
    const elements = []

    loot.childNodes.forEach(node => {
      if (node.nodeName === "RulesElement") {
        const element = {
          name: node.getAttribute("name"),
          type: node.getAttribute("type"),
          count: loot.getAttribute("count"),
          equipCount: loot.getAttribute("equip-count")
        }
        elements.push(element)
      }
    })

    return elements
  }

  async _importCompositeItem(compositeItem) {
    const pack = game.packs.get("dnd-4e-compendium.module-equipment")
    if (!pack) {
      console.warn("Equipment compendium not found")
      return null
    }

    // Handle single items
    if (compositeItem.length === 1) {
      return await this._importSingleItem(compositeItem[0], pack)
    }

    // Handle composite items (base + enchantment)
    if (compositeItem.length === 2) {
      return await this._importCompositeItemWithEnchantment(compositeItem, pack)
    }

    console.warn("Unsupported composite item structure:", compositeItem)
    return null
  }

  async _importSingleItem(itemData, pack) {
    let resolvedName = lookup.equipment[itemData.name] || itemData.name
    const index = await pack.getIndex()
    
    let entry = index.find(e => e.name === resolvedName)
    
    // Handle tier-based items
    if (!entry && itemData.name.includes("(paragon tier)")) {
      resolvedName = itemData.name.replace("(paragon tier)", "(Level 12)")
      entry = index.find(e => e.name === resolvedName)
    }
    if (!entry && itemData.name.includes("(epic tier)")) {
      resolvedName = itemData.name.replace("(epic tier)", "(Level 22)")
      entry = index.find(e => e.name === resolvedName)
    }
    if (!entry && itemData.name.includes("(heroic tier)")) {
      resolvedName = itemData.name.replace("(heroic tier)", "(Level 2)")
      entry = index.find(e => e.name === resolvedName)
    }

    // Try pattern matching as fallback
    if (!entry) {
      const pattern = new RegExp(resolvedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
      entry = index.find(e => e.name.match(pattern))
    }

    // Try normalized name (remove parentheses)
    if (!entry) {
      const normalizedName = resolvedName.replace(/\s*\(.*?\)/, "").trim()
      const pattern = new RegExp(normalizedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
      entry = index.find(e => e.name.match(pattern))
    }

    // Try partial matching for complex names - but be more restrictive
    if (!entry) {
      const words = resolvedName.split(/\s+/).filter(w => w.length > 3) // Only use words longer than 3 characters
      if (words.length > 1) {
        // Try to match on multiple words together, not just single words
        for (let i = 0; i < words.length - 1; i++) {
          const wordPair = `${words[i]}\\s+${words[i + 1]}`
          const pattern = new RegExp(wordPair.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
          entry = index.find(e => e.name.match(pattern))
          if (entry) {
            break
          }
        }
        
        // If no word pair match, try the first significant word only
        if (!entry && words.length > 0) {
          const firstWord = words[0]
          const pattern = new RegExp(`^${firstWord.replace(/[\(\)\[\]\+]/g, "\\$&")}`, "i")
          entry = index.find(e => e.name.match(pattern))
        }
      }
    }

    if (!entry) {
      console.warn(`Equipment not found: ${resolvedName}`)
      return null
    }

    const item = await pack.getDocument(entry._id)
    if (item) {
      const itemObj = item.toObject()
      itemObj.system.quantity = Number(itemData.count) || 1
      
      // Set equipped status based on equip-count from XML
      const equipCount = Number(itemData.equipCount) || 0
      const shouldBeEquipped = equipCount > 0
      itemObj.system.equipped = shouldBeEquipped
      
      // Ensure the equipped status is correctly set
      if (itemObj.system.equipped !== shouldBeEquipped) {
        console.warn(`  ⚠️ Equipped status mismatch for ${itemData.name}: expected ${shouldBeEquipped}, got ${itemObj.system.equipped}`)
        itemObj.system.equipped = shouldBeEquipped
      }
      
      // Add a flag to track that we've explicitly set the equipped status
      if (!itemObj.flags) itemObj.flags = {}
      if (!itemObj.flags.import4e) itemObj.flags.import4e = {}
      itemObj.flags.import4e.equippedStatusSet = true
      itemObj.flags.import4e.originalEquippedStatus = shouldBeEquipped
      
      return itemObj
    }

    return null
  }

  async _importCompositeItemWithEnchantment(compositeItem, pack) {
    const baseItem = compositeItem[0]
    const enchantmentItem = compositeItem[1]

    // Try to find base item
    let baseItemRef = await this._fetchItems("dnd-4e-compendium.module-equipment", [baseItem.name], lookup.equipment)
    
    // Try to find enchantment
    let enchantmentRef = await this._fetchItems("dnd-4e-compendium.module-equipment", [enchantmentItem.name], lookup.equipment)

    if (baseItemRef.length === 0 || enchantmentRef.length === 0) {
      console.warn(`Could not find base item or enchantment: ${baseItem.name} / ${enchantmentItem.name}`)
      return null
    }

    // Merge the items
    const mergedItem = await this._mergeItems(baseItemRef[0], enchantmentRef[0])
    if (mergedItem) {
      mergedItem.system.quantity = Number(baseItem.count) || 1
      
      // Set equipped status based on equip-count from XML
      const equipCount = Number(baseItem.equipCount) || 0
      const shouldBeEquipped = equipCount > 0
      mergedItem.system.equipped = shouldBeEquipped
      
      // Ensure the equipped status is correctly set
      if (mergedItem.system.equipped !== shouldBeEquipped) {
        console.warn(`  ⚠️ Equipped status mismatch for composite ${mergedItem.name}: expected ${shouldBeEquipped}, got ${mergedItem.system.equipped}`)
        mergedItem.system.equipped = shouldBeEquipped
      }
      
      return mergedItem
    }

    return null
  }

  async _mergeItems(baseItem, enchantmentItem) {
    try {
      // Create a copy of the base item
      const mergedItem = foundry.utils.deepClone(baseItem)

      // Merge enchantment properties
      if (enchantmentItem.system) {
        // Merge enhancement bonus
        if (enchantmentItem.system.enhancement) {
          mergedItem.system.enhancement = enchantmentItem.system.enhancement
        }

        // Merge other properties as needed
        if (enchantmentItem.system.properties) {
          mergedItem.system.properties = foundry.utils.mergeObject(
            mergedItem.system.properties || {},
            enchantmentItem.system.properties
          )
        }
      }

      // Update name to reflect the composite item
      mergedItem.name = `${baseItem.name} ${enchantmentItem.name}`

      return mergedItem
    } catch (err) {
      console.error("Error merging items:", err)
      return null
    }
  }

  async _fetchSpecialItems(xml, details) {
    const results = []
    const seenSpecialItems = new Set() // Track seen special items to prevent duplicates
    
    // Handle special items that might be class features or unique items
    const specialItemNames = [
      "Arcanist Cantrips",
      "Spellbook",
      "Familiar",
      "Animal Companion",
      "Mount",
      "Servant",
      "Retainer"
    ]

    // Check if any of these special items exist in the character's actual inventory
    // Only look in LootTally section where items are actually owned
    for (const itemName of specialItemNames) {
      const itemElements = xml.querySelectorAll(`LootTally > loot > RulesElement[name*="${itemName}"]`)
      if (itemElements.length > 0) {
        // Only process if the item has count > 0 (actually owned)
        const ownedItems = Array.from(itemElements).filter(elem => {
          const lootElement = elem.closest('loot')
          return lootElement && lootElement.getAttribute("count") !== "0"
        })
        
        if (ownedItems.length > 0) {
          // Try to find as a feature first
          let item = await this._fetchItems("dnd-4e-compendium.module-features", [itemName], {})
          if (item.length === 0) {
            // Try as equipment
            item = await this._fetchItems("dnd-4e-compendium.module-equipment", [itemName], {})
          }
          if (item.length === 0) {
            // Try as feat
            item = await this._fetchItems("dnd-4e-compendium.module-feats", [itemName], {})
          }
          
          if (item.length > 0) {
            // Check for duplicates before adding
            for (const specialItem of item) {
              if (!seenSpecialItems.has(specialItem.name)) {
                results.push(specialItem)
                seenSpecialItems.add(specialItem.name)
              }
            }
          } else {
            console.warn(`Special item not found: ${itemName}`)
          }
        }
      }
    }

    // Handle class-specific special items
    if (details.class === "Wizard") {
      // Check if Spellbook is actually in the character's inventory
      const spellbookElements = xml.querySelectorAll(`LootTally > loot > RulesElement[name*="Spellbook"]`)
      const ownedSpellbook = Array.from(spellbookElements).filter(elem => {
        const lootElement = elem.closest('loot')
        return lootElement && lootElement.getAttribute("count") !== "0"
      })
      
      if (ownedSpellbook.length > 0) {
        const spellbook = await this._fetchItems("dnd-4e-compendium.module-features", ["Spellbook"], {})
        if (spellbook.length > 0) {
          for (const spellbookItem of spellbook) {
            if (!seenSpecialItems.has(spellbookItem.name)) {
              results.push(spellbookItem)
              seenSpecialItems.add(spellbookItem.name)
            }
          }
        }
      }
    }

    return results
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

  _getHeritageFeatures(xml) {
    const heritage = []
    function recurse(node) {
      if (node.nodeType === 1 && node.nodeName === 'RulesElement' && node.getAttribute('type') === 'Racial Trait') {
        const name = node.getAttribute('name')
        if (name) heritage.push(name)
      }
      for (let i = 0; i < node.childNodes.length; i++) {
        recurse(node.childNodes[i])
      }
    }
    recurse(xml)
    return heritage
  }

  async _fetchHeritageFeatures(xml) {
    const heritageNames = this._getHeritageFeatures(xml)
    if (!heritageNames.length) return []
    const packsToSearch = [
      "dnd-4e-compendium.module-features",
      "dnd-4e-compendium.module-races"
    ]
    const results = []
    const seen = new Set()
    // Helper to normalize names for robust matching
    const normalizeName = (str) => (str ?? "").trim().normalize("NFKC")
    for (const rawName of heritageNames) {
      const normRawName = normalizeName(rawName)
      let found = false
      for (const packId of packsToSearch) {
        const pack = game.packs.get(packId)
        if (!pack) continue
        const index = await pack.getIndex()
        let entry = null
        // 1. Lookup table (future-proof, not implemented yet)
        // const canonicalName = lookup.heritage?.[rawName] || rawName
        // 2. Exact match (normalized)
        entry = index.find(e => normalizeName(e.name) === normRawName)
        // 3. Partial regex match (case-insensitive, normalized)
        if (!entry) {
          const pattern = new RegExp(normRawName.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1"), "i")
          const matches = index.filter(e => normalizeName(e.name).match(pattern))
          if (matches.length > 0) {
            matches.sort((a, b) => a.name.length - b.name.length)
            entry = matches[0]
          }
        }
        // 4. Normalized name (remove parentheticals, then normalize)
        if (!entry && typeof rawName === "string") {
          const noParen = normRawName.replace(/\s*\(.*?\)$/, "").trim()
          const pattern = new RegExp(noParen.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1"), "i")
          const matches = index.filter(e => normalizeName(e.name).match(pattern))
          if (matches.length > 0) {
            matches.sort((a, b) => a.name.length - b.name.length)
            entry = matches[0]
          }
        }
        if (entry) {
          const item = await pack.getDocument(entry._id)
          if (item && !seen.has(item.name)) {
            const obj = item.toObject()
            if (!obj.flags) obj.flags = {}
            if (!obj.flags.import4e) obj.flags.import4e = {}
            obj.flags.import4e.heritageFeature = true
            results.push(obj)
            seen.add(item.name)
            found = true
            break // Stop searching other packs for this name
          }
        }
      }
      if (!found) {
        console.warn(`Racial feature not found: ${rawName}`)
      }
    }
    return results
  }

  // Recursively collect all RulesElement elements of type 'Class Feature' in the XML
  _getClassFeatures(xml) {
    const features = []
    function recurse(node) {
      if (node.nodeType === 1 && node.nodeName === 'RulesElement' && node.getAttribute('type') === 'Class Feature') {
        const name = node.getAttribute('name')
        if (name) features.push(name)
      }
      for (let i = 0; i < node.childNodes.length; i++) {
        recurse(node.childNodes[i])
      }
    }
    recurse(xml)
    return features
  }
}
