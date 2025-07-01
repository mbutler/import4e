import { lookup } from "../tools/lookup_tables.js"

export class ImporterApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "importer-app",
      title: "D&D 4E Character Importer",
      template: "modules/import4e/templates/importer-dialog.hbs",
      classes: ["dnd4e", "importer"],
      width: 400,
      closeOnSubmit: false
    })
  }

  constructor(...args) {
    super(...args)
    this._xmlText = null
  }

  async getData() {
    return {
      hint1: "Choose a .dnd4e file to import.",
      hint2: "Click Import to create the character.",
      hint3: "This imports feats, features, powers, level, class, race, and abilities."
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

  async _updateObject(event, formData) {
    if (!this._xmlText) {
      ui.notifications.error("No file selected.")
      return
    }

    try {
      const parser = new DOMParser()
      const xml = parser.parseFromString(this._xmlText, "text/xml")

      const details = this._getDetails(xml)
      if (!details.name) {
        ui.notifications.error("Parsed character name was empty — aborting import.")
        return
      }

      console.log("Parsed character:", details)
      console.log("Character stats:", {
        abilities: details.abilities,
        defenses: details.defenses,
        hitPoints: details.hitPoints,
        healingSurges: details.healingSurges,
        initiative: details.initiative,
        speed: details.speed,
        actionPoints: details.actionPoints,
        paragonPath: details.paragonPath,
        epicDestiny: details.epicDestiny
      })
      
      // Debug: Log the actual XML values we're parsing
      console.log("=== XML PARSING DEBUG ===")
      const debugXml = parser.parseFromString(this._xmlText, "text/xml")
      console.log("AC XML value:", debugXml.querySelector('Stat > alias[name="AC"]')?.parentElement?.getAttribute("value"))
      console.log("Fortitude XML value:", debugXml.querySelector('Stat > alias[name="Fortitude"]')?.parentElement?.getAttribute("value"))
      console.log("Reflex XML value:", debugXml.querySelector('Stat > alias[name="Reflex"]')?.parentElement?.getAttribute("value"))
      console.log("Will XML value:", debugXml.querySelector('Stat > alias[name="Will"]')?.parentElement?.getAttribute("value"))
      console.log("Healing Surges XML value:", debugXml.querySelector('Stat > alias[name="Healing Surges"]')?.parentElement?.getAttribute("value"))
      console.log("=== END XML DEBUG ===")

      const featNames = Object.values(this._getRulesElements(xml, "Feat"))
      const featureNames = Object.values(this._getRulesElements(xml, "Class Feature"))
      const powerNames = this._getPowerNames(xml)
      
      console.log("Power names found:", powerNames)
      
      const loot = this._getLoot(xml)
      console.log("Loot found:", loot)
      console.log("Loot details:", loot.map(item => item.map(i => ({ name: i.name, type: i.type, count: i.count }))))
      


      const feats = await this._fetchItems("dnd-4e-compendium.module-feats", featNames, lookup.feat, true)
      const features = await this._fetchItems("dnd-4e-compendium.module-features", featureNames, lookup.feature, true)
      const powers = await this._fetchPowers(powerNames, details.class, details.classes)
      const corePowers = await this._fetchCorePowers(details.classes)
      const equipment = await this._fetchEquipment(xml)
      const rituals = await this._fetchRituals(xml)
      const specialItems = await this._fetchSpecialItems(xml, details)

      // Debug: Check for cross-category duplicates
      console.log("=== CROSS-CATEGORY DUPLICATE CHECK ===")
      console.log("Feats:", feats.map(f => f.name))
      console.log("Features:", features.map(f => f.name))
      console.log("Powers:", powers.map(p => p.name))
      console.log("Core Powers:", corePowers.map(p => p.name))
      console.log("Equipment:", equipment.map(e => e.name))
      console.log("Rituals:", rituals.map(r => r.name))
      console.log("Special Items:", specialItems.map(s => s.name))
      
      const debugItems = [...feats, ...features, ...powers, ...corePowers, ...equipment, ...rituals, ...specialItems]
      const itemNames = debugItems.map(item => item.name)
      const duplicates = itemNames.filter((name, index) => itemNames.indexOf(name) !== index)
      if (duplicates.length > 0) {
        console.log("Cross-category duplicates found:", [...new Set(duplicates)])
        console.log("All item names:", itemNames)
      }
      console.log("=== END DUPLICATE CHECK ===")

      // Final deduplication pass across all categories
      const allItems = [...feats, ...features, ...powers, ...corePowers, ...equipment, ...rituals, ...specialItems]
      const finalItems = this._deduplicateFinalItems(allItems)
      
      // Debug: Check what items might be affecting AC
      console.log("=== AC AFFECTING ITEMS DEBUG ===")
      const acItems = allItems.filter(item => 
        item.name?.toLowerCase().includes('armor') || 
        item.name?.toLowerCase().includes('shield') ||
        item.name?.toLowerCase().includes('ac') ||
        item.name?.toLowerCase().includes('defense')
      )
      console.log("Items that might affect AC:", acItems.map(item => item.name))
      console.log("=== END AC ITEMS DEBUG ===")
      
      // Create actor with correct values
      const actor = await Actor.create({
        name: details.name,
        type: "Player Character",
        system: {
          details: {
            level: details.level,
            class: details.class,
            race: details.race,
            paragon: details.paragonPath,
            epic: details.epicDestiny,
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
            ac: { value: details.defenses.ac },
            fort: { value: details.defenses.fortitude },
            ref: { value: details.defenses.reflex },
            wil: { value: details.defenses.will }
          },
          attributes: {
            hp: {
              value: details.hitPoints.current,
              max: details.hitPoints.maximum
            },
            init: { value: details.initiative },
            speed: { value: details.speed }
          },
          actionpoints: { value: details.actionPoints }
        }
      })
      
      // Import items normally
      await actor.createEmbeddedDocuments("Item", finalItems)
      
      // Force update defense values to match XML values
      // Use direct property assignment to avoid system recalculation
      actor.system.defences.ac.value = details.defenses.ac
      actor.system.defences.fort.value = details.defenses.fortitude
      actor.system.defences.ref.value = details.defenses.reflex
      actor.system.defences.wil.value = details.defenses.will
      
      // Update the actor to save the changes
      await actor.update({
        "system.defences.ac.value": details.defenses.ac,
        "system.defences.fort.value": details.defenses.fortitude,
        "system.defences.ref.value": details.defenses.reflex,
        "system.defences.wil.value": details.defenses.will
      })      


      ui.notifications.info(`Imported ${details.name} with ${finalItems.length} total items (${feats.length} feats, ${features.length} features, ${powers.length} powers, ${corePowers.length} core powers, ${equipment.length} equipment, ${rituals.length} rituals, ${specialItems.length} special items).`)
    } catch (err) {
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
          console.log(`Found ${aliasName} with value: ${value}`)
          return value
        }
      }
      console.log(`No match found for aliases: ${aliases.join(', ')}`)
      return 10
    }

    const className = Object.values(this._getRulesElements(xml, "Class"))[0] || ""
    const raceName = Object.values(this._getRulesElements(xml, "Race"))[0] || ""
    const paragonPathName = Object.values(this._getRulesElements(xml, "Paragon Path"))[0] || ""
    const epicDestinyName = Object.values(this._getRulesElements(xml, "Epic Destiny"))[0] || ""

    // Handle hybrid classes
    let classes = [className]
    if (className === "Hybrid") {
      const hybridClasses = Object.values(this._getRulesElements(xml, "Hybrid Class"))
      classes = hybridClasses.map(c => c.replace("Hybrid ", ""))
    }

    return {
      name: getText("name") || "Unnamed Character",
      level: Number(getText("Level")) || 1,
      class: className,
      classes: classes,
      race: raceName,
      paragonPath: paragonPathName,
      epicDestiny: epicDestinyName,
      abilities: {
        str: getStat("str"),
        con: getStat("con"),
        dex: getStat("dex"),
        int: getStat("int"),
        wis: getStat("wis"),
        cha: getStat("cha")
      },
      // Add computed stats
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
        value: getStat("Healing Surges") // This will be calculated based on level and constitution
      },
      initiative: getStat("Initiative"),
      speed: getStat("Speed") || 6, // Default to 6 if not found
      actionPoints: getStat("_BaseActionPoints") || 1,
      exp: Number(getText("Experience")) || 0
    }
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
            console.log(`Imported power: ${item.name} (from ${powerName})`)
          } else {
            console.log(`Skipped duplicate power: ${item.name} (ID: ${item._id})`)
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
      const results = []

      // Filter core powers based on character classes
      for (const power of allCorePowers) {
        const powerName = power.name.toLowerCase()
        const isRelevant = classes.some(className => {
          const classNameLower = className.toLowerCase()
          return powerName.includes(classNameLower) || 
                 powerName.includes("basic") || 
                 powerName.includes("at-will")
        })
        
        if (isRelevant) {
          results.push(power.toObject())
        }
      }

      console.log(`Found ${results.length} relevant core powers for classes: ${classes.join(", ")}`)
      return results
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

    if (bestMatch) {
      console.log(`Fuzzy matched: "${powerName}" -> "${bestMatch.name}" (score: ${bestScore.toFixed(2)})`)
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
            console.log(`Created placeholder: ${placeholder.name}`)
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
          console.log(`Imported item: ${item.name} (from ${rawName})`)
        } else {
          console.log(`Skipped duplicate: ${item.name} (ID: ${item._id})`)
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

    console.log("=== EQUIPMENT IMPORT DEBUG ===")
    console.log("Processing loot items:", loot.length)
    console.log("Raw loot data:", loot.map(item => item.map(i => ({ name: i.name, type: i.type, count: i.count, equipCount: i.equipCount }))))

    for (const compositeItem of loot) {
      if (compositeItem.length === 0) continue

      // Skip rituals - they should be handled by _fetchRituals
      const hasRitual = compositeItem.some(item => 
        item.type === "Ritual" || 
        this._isRitualName(item.name)
      )
      if (hasRitual) {
        console.log(`Skipping ritual in equipment import: ${compositeItem.map(i => i.name).join(" + ")}`)
        continue
      }

      console.log("Processing composite item:", compositeItem.map(i => i.name))

      try {
        const importedItem = await this._importCompositeItem(compositeItem)
        if (importedItem) {
          // Check for duplicates before adding
          if (!seenEquipment.has(importedItem.name)) {
            results.push(importedItem)
            seenEquipment.add(importedItem.name)
            console.log(`✓ Imported equipment: ${importedItem.name}`)
          } else {
            console.log(`Skipped duplicate equipment: ${importedItem.name}`)
          }
        } else {
          console.log(`✗ Failed to import composite item: ${compositeItem.map(i => i.name).join(" + ")}`)
        }
      } catch (err) {
        console.error("Error importing composite item:", err)
      }
    }

    console.log(`Found ${results.length} equipment items`)
    console.log("Equipment items:", results.map(item => item.name))
    

    
    console.log("=== END EQUIPMENT DEBUG ===")
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
            } else {
              console.log(`Skipped duplicate ritual: ${importedRitual.name}`)
            }
          }
        } catch (err) {
          console.error("Error importing ritual:", err)
        }
      }
    }

    console.log(`Found ${results.length} ritual items`)
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
      console.log(`Imported ritual: ${ritual.name}`)
      return ritualObj
    }

    return null
  }

  _getLoot(xml) {
    const elements = []

    console.log("=== LOOT EXTRACTION DEBUG ===")
    const allLootElements = xml.querySelectorAll("LootTally > loot")
    console.log(`Found ${allLootElements.length} total loot elements`)
    

    
    allLootElements.forEach((loot, index) => {
      const count = loot.getAttribute("count")
      const equipCount = loot.getAttribute("equip-count")
      console.log(`Loot element ${index}: count=${count}, equip-count=${equipCount}`)
      
      if (count !== "0") {
        const components = this._getLootComponents(loot)
        if (components.length > 0) {
          elements.push(components)
          console.log(`  ✓ Added loot with components:`, components.map(c => c.name))
        }
      } else {
        console.log(`  ✗ Skipped loot with count=0`)
      }
    })

    console.log(`Final loot elements: ${elements.length}`)
    console.log("=== END LOOT EXTRACTION DEBUG ===")
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
    
    console.log(`  Looking for: "${itemData.name}" -> resolved to: "${resolvedName}"`)
    console.log(`  Item data:`, itemData)
    
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
      if (entry) console.log(`  ✓ Pattern matched: "${entry.name}"`)
    }

    // Try normalized name (remove parentheses)
    if (!entry) {
      const normalizedName = resolvedName.replace(/\s*\(.*?\)/, "").trim()
      const pattern = new RegExp(normalizedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
      entry = index.find(e => e.name.match(pattern))
      if (entry) console.log(`  ✓ Normalized match: "${entry.name}"`)
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
            console.log(`  ✓ Partial word pair match: "${entry.name}" (matched on "${words[i]} ${words[i + 1]}")`)
            break
          }
        }
        
        // If no word pair match, try the first significant word only
        if (!entry && words.length > 0) {
          const firstWord = words[0]
          const pattern = new RegExp(`^${firstWord.replace(/[\(\)\[\]\+]/g, "\\$&")}`, "i")
          entry = index.find(e => e.name.match(pattern))
          if (entry) {
            console.log(`  ✓ First word match: "${entry.name}" (matched on "${firstWord}")`)
          }
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
      console.log(`  ✓ Found equipment: "${item.name}" (from "${itemData.name}")`)
      return itemObj
    }

    return null
  }

  async _importCompositeItemWithEnchantment(compositeItem, pack) {
    const baseItem = compositeItem[0]
    const enchantmentItem = compositeItem[1]

    console.log(`  Composite item - Base: "${baseItem.name}", Enchantment: "${enchantmentItem.name}"`)

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
      console.log(`Imported composite equipment: ${mergedItem.name}`)
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
                console.log(`Imported special item: ${itemName}`)
              } else {
                console.log(`Skipped duplicate special item: ${specialItem.name}`)
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
              console.log("Imported Wizard Spellbook")
            } else {
              console.log(`Skipped duplicate Wizard Spellbook: ${spellbookItem.name}`)
            }
          }
        }
      }
    }

    console.log(`Found ${results.length} special items`)
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
        console.log(`Final import: ${item.name}`)
      } else {
        console.log(`Final deduplication skipped: ${item.name}`)
      }
    }

    console.log(`Final deduplication: ${allItems.length} -> ${finalItems.length} items`)
    return finalItems
  }
}
