// Compendium lookup helpers for import4e
// Exported functions: fetchItems, createPlaceholderItem, fetchRituals, importRitual, fetchSpecialItems, fetchHeritageFeatures

import { getLoot, getHeritageFeatures } from './xmlParsing.js';
import { lookup } from '../tools/lookup_tables.js';

export async function fetchItems(packId, names, lookupTable = {}, createPlaceholders = false) {
  const pack = game.packs.get(packId)
  if (!pack) throw new Error(`Compendium not found: ${packId}`)

  const index = await pack.getIndex()
  const results = []
  const seenItems = new Set()
  const seenItemIds = new Set()

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
        const placeholder = createPlaceholderItem(rawName, packId)
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

export function createPlaceholderItem(name, packId) {
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

export async function fetchRituals(xml, importRitual, isRitualName) {
  const loot = getLoot(xml)
  const results = []
  const seenRituals = new Set()
  for (const compositeItem of loot) {
    if (compositeItem.length === 0) continue
    const hasRitual = compositeItem.some(item => item.type === "Ritual" || isRitualName(item.name))
    if (hasRitual) {
      try {
        const importedRitual = await importRitual(compositeItem)
        if (importedRitual && !seenRituals.has(importedRitual.name)) {
          results.push(importedRitual)
          seenRituals.add(importedRitual.name)
        }
      } catch (err) {
        console.error("Error importing ritual:", err)
      }
    }
  }
  return results
}

export async function importRitual(compositeItem, isRitualName) {
  const pack = game.packs.get("dnd-4e-compendium.module-rituals")
  if (!pack) {
    console.warn("Ritual compendium not found")
    return null
  }
  const ritualComponent = compositeItem.find(item => item.type === "Ritual" || isRitualName(item.name))
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
    const equipCount = Number(ritualComponent.equipCount) || 0
    const shouldBeEquipped = equipCount > 0
    ritualObj.system.equipped = shouldBeEquipped
    if (ritualObj.system.equipped !== shouldBeEquipped) {
      console.warn(`  ⚠️ Equipped status mismatch for ritual ${ritual.name}: expected ${shouldBeEquipped}, got ${ritualObj.system.equipped}`)
      ritualObj.system.equipped = shouldBeEquipped
    }
    return ritualObj
  }
  return null
}

export async function fetchSpecialItems(xml, fetchItems) {
  const results = []
  const seenSpecialItems = new Set()
  const specialItemNames = [
    "Arcanist Cantrips",
    "Spellbook",
    "Familiar",
    "Animal Companion",
    "Mount",
    "Servant",
    "Retainer"
  ]
  for (const itemName of specialItemNames) {
    const itemElements = xml.querySelectorAll(`LootTally > loot > RulesElement[name*="${itemName}"]`)
    if (itemElements.length > 0) {
      const ownedItems = Array.from(itemElements).filter(elem => {
        const lootElement = elem.closest('loot')
        return lootElement && lootElement.getAttribute("count") !== "0"
      })
      if (ownedItems.length > 0) {
        let item = await fetchItems("dnd-4e-compendium.module-features", [itemName], {})
        if (item.length === 0) {
          item = await fetchItems("dnd-4e-compendium.module-equipment", [itemName], {})
        }
        if (item.length === 0) {
          item = await fetchItems("dnd-4e-compendium.module-feats", [itemName], {})
        }
        if (item.length > 0) {
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
  return results
}

export async function fetchHeritageFeatures(xml) {
  const heritageNames = getHeritageFeatures(xml)
  if (!heritageNames.length) return []
  const packsToSearch = [
    "dnd-4e-compendium.module-features",
    "dnd-4e-compendium.module-races"
  ]
  const results = []
  const seen = new Set()
  const normalizeName = (str) => (str ?? "").trim().normalize("NFKC")
  for (const rawName of heritageNames) {
    const normRawName = normalizeName(rawName)
    let found = false
    for (const packId of packsToSearch) {
      const pack = game.packs.get(packId)
      if (!pack) continue
      const index = await pack.getIndex()
      let entry = null
      entry = index.find(e => normalizeName(e.name) === normRawName)
      if (!entry) {
        const pattern = new RegExp(normRawName.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1"), "i")
        const matches = index.filter(e => normalizeName(e.name).match(pattern))
        if (matches.length > 0) {
          matches.sort((a, b) => a.name.length - b.name.length)
          entry = matches[0]
        }
      }
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
          break
        }
      }
    }
  }
  return results
} 