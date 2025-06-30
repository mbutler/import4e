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
      hint3: "This imports feats, features, level, class, race, and abilities."
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


      const feats = await this._fetchItems("dnd-4e-compendium.module-feats", featNames, lookup.feat)
      const features = await this._fetchItems("dnd-4e-compendium.module-features", featureNames, lookup.feature)

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

      ui.notifications.info(`Imported ${details.name} with ${feats.length} feats and ${features.length} features.`)
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

    return {
      name: getText("name") || "Unnamed Character",
      level: Number(getText("Level")) || 1,
      class: className,
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
