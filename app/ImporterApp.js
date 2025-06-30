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

      const featNames = Object.values(this._getRulesElements(xml, "Feat"))
      const featureNames = Object.values(this._getRulesElements(xml, "Class Feature"))
      const powerNames = this._getPowerNames(xml)
      
      console.log("Power names found:", powerNames)

      const feats = await this._fetchItems("dnd-4e-compendium.module-feats", featNames, lookup.feat)
      const features = await this._fetchItems("dnd-4e-compendium.module-features", featureNames, lookup.feature)
      const powers = await this._fetchPowers(powerNames, details.class, details.classes)
      const corePowers = await this._fetchCorePowers(details.classes)

      const actor = await Actor.create({
        name: details.name,
        type: "Player Character"
      })

      await actor.update({
        "system.details.level": details.level,
        "system.details.class": details.class,
        "system.details.race": details.race,
        "system.abilities.str.value": details.abilities.str,
        "system.abilities.con.value": details.abilities.con,
        "system.abilities.dex.value": details.abilities.dex,
        "system.abilities.int.value": details.abilities.int,
        "system.abilities.wis.value": details.abilities.wis,
        "system.abilities.cha.value": details.abilities.cha
      })

      await actor.createEmbeddedDocuments("Item", feats)
      await actor.createEmbeddedDocuments("Item", features)
      await actor.createEmbeddedDocuments("Item", powers)
      await actor.createEmbeddedDocuments("Item", corePowers)

      ui.notifications.info(`Imported ${details.name} with ${feats.length} feats, ${features.length} features, ${powers.length} powers, and ${corePowers.length} core powers.`)
    } catch (err) {
      console.error(err)
      ui.notifications.error("Failed to import character.")
    }
  }

  _getDetails(xml) {
    const getText = tag => xml.querySelector(`Details > ${tag}`)?.textContent?.trim() || ""
    const getStat = alias => {
      const match = xml.querySelector(`Stat > alias[name='${alias}']`)
      return match ? Number(match.parentElement.getAttribute("value")) : 10
    }

    const className = Object.values(this._getRulesElements(xml, "Class"))[0] || ""
    const raceName = Object.values(this._getRulesElements(xml, "Race"))[0] || ""

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
      abilities: {
        str: getStat("str"),
        con: getStat("con"),
        dex: getStat("dex"),
        int: getStat("int"),
        wis: getStat("wis"),
        cha: getStat("cha")
      }
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

    // Filter out obsolete powers
    Object.keys(powers).forEach(id => {
      if (!powersObsolete[id]) {
        powersRetained.push(powers[id])
      }
    })

    return powersRetained
  }

  async _fetchPowers(powerNames, className, classes) {
    const pack = game.packs.get("dnd-4e-compendium.module-powers")
    if (!pack) {
      console.warn("Power compendium not found")
      return []
    }

    const index = await pack.getIndex()
    const results = []

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
        // Fallback: try normalized name
        const normalizedName = powerName.replace(/\s*\(.*?\)$/, "").trim()
        const pattern = new RegExp(normalizedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
        const matches = index.filter(e => e.name.match(pattern))
        
        if (matches.length > 0) {
          entry = this._selectBestPowerMatch(matches, classes)
        }
      }

      if (entry) {
        const item = await pack.getDocument(entry._id)
        if (item) {
          results.push(item.toObject())
          console.log(`Imported power: ${item.name}`)
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
      // For single class, prefer non-hybrid versions
      const nonHybrid = matches.find(m => !m.name.includes("Hybrid"))
      if (nonHybrid) {
        return nonHybrid
      }
    }

    // Fallback to first match
    return matches[0]
  }

  async _fetchItems(packId, names, lookupTable = {}) {
    const pack = game.packs.get(packId)
    if (!pack) throw new Error(`Compendium not found: ${packId}`)

    const index = await pack.getIndex()
    const results = []

    for (const rawName of names) {
      const resolvedName = lookupTable[rawName] || rawName
      const entry = index.find(e =>
        e.name === resolvedName ||
        e.name.replace(/\s*\(.*?\)/, "").trim() === resolvedName
      )
      if (!entry) {
        console.warn(`Item not found: ${resolvedName}`)
        continue
      }
      const item = await pack.getDocument(entry._id)
      if (item) results.push(item.toObject())
    }

    return results
  }
}
