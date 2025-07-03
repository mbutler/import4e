// Equipment-related helpers for import4e
// Exported functions: fetchEquipment, importCompositeItem, importSingleItem, importCompositeItemWithEnchantment, mergeItems

import { getLoot } from './xmlParsing.js';
import { lookup } from '../tools/lookup_tables.js';

export async function fetchEquipment(xml, importCompositeItem, isRitualName) {
  const loot = getLoot(xml)
  const results = []
  const seenEquipment = new Set()
  for (const compositeItem of loot) {
    if (compositeItem.length === 0) continue
    const hasRitual = compositeItem.some(item => item.type === "Ritual" || isRitualName(item.name))
    if (hasRitual) continue
    try {
      const importedItem = await importCompositeItem(compositeItem)
      if (importedItem && !seenEquipment.has(importedItem.name)) {
        results.push(importedItem)
        seenEquipment.add(importedItem.name)
      }
    } catch (err) {
      console.error("Error importing composite item:", err)
    }
  }
  return results
}

export async function importCompositeItem(compositeItem) {
  const pack = game.packs.get("dnd-4e-compendium.module-equipment")
  if (!pack) {
    console.warn("Equipment compendium not found")
    return null
  }
  if (compositeItem.length === 1) {
    return await importSingleItem(compositeItem[0], pack)
  }
  if (compositeItem.length === 2) {
    return await importCompositeItemWithEnchantment(compositeItem, pack)
  }
  console.warn("Unsupported composite item structure:", compositeItem)
  return null
}

export async function importSingleItem(itemData, pack) {
  let resolvedName = lookup.equipment[itemData.name] || itemData.name
  const index = await pack.getIndex()
  let entry = index.find(e => e.name === resolvedName)
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
  if (!entry) {
    const pattern = new RegExp(resolvedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
    entry = index.find(e => e.name.match(pattern))
  }
  if (!entry) {
    const normalizedName = resolvedName.replace(/\s*\(.*?\)/, "").trim()
    const pattern = new RegExp(normalizedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
    entry = index.find(e => e.name.match(pattern))
  }
  if (!entry) {
    const words = resolvedName.split(/\s+/).filter(w => w.length > 3)
    if (words.length > 1) {
      for (let i = 0; i < words.length - 1; i++) {
        const wordPair = `${words[i]}\s+${words[i + 1]}`
        const pattern = new RegExp(wordPair.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
        entry = index.find(e => e.name.match(pattern))
        if (entry) break
      }
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
    // Set equipped status based on equipCount
    const equipCount = Number(itemData.equipCount) || 0
    const shouldBeEquipped = equipCount > 0
    itemObj.system.equipped = shouldBeEquipped
    
    // Set flags for post-import equipped status fix
    if (!itemObj.flags) itemObj.flags = {}
    if (!itemObj.flags.import4e) itemObj.flags.import4e = {}
    itemObj.flags.import4e.equippedStatusSet = true
    itemObj.flags.import4e.originalEquippedStatus = shouldBeEquipped
    
    return itemObj
  }
  return null
}

export async function importCompositeItemWithEnchantment(compositeItem, pack) {
  const baseItem = compositeItem[0]
  const enchantmentItem = compositeItem[1]
  let baseItemRef = await fetchItems("dnd-4e-compendium.module-equipment", [baseItem.name], lookup.equipment)
  let enchantmentRef = await fetchItems("dnd-4e-compendium.module-equipment", [enchantmentItem.name], lookup.equipment)
  if (baseItemRef.length === 0 || enchantmentRef.length === 0) {
    console.warn(`Could not find base item or enchantment: ${baseItem.name} / ${enchantmentItem.name}`)
    return null
  }
  const mergedItem = await mergeItems(baseItemRef[0], enchantmentRef[0])
  if (mergedItem) {
    mergedItem.system.quantity = Number(baseItem.count) || 1
    const equipCount = Number(baseItem.equipCount) || 0
    const shouldBeEquipped = equipCount > 0
    mergedItem.system.equipped = shouldBeEquipped
    
    // Set flags for post-import equipped status fix
    if (!mergedItem.flags) mergedItem.flags = {}
    if (!mergedItem.flags.import4e) mergedItem.flags.import4e = {}
    mergedItem.flags.import4e.equippedStatusSet = true
    mergedItem.flags.import4e.originalEquippedStatus = shouldBeEquipped
    
    return mergedItem
  }
  return null
}

export async function mergeItems(baseItem, enchantmentItem) {
  const mergedItem = foundry.utils.deepClone(baseItem)
  mergedItem.system = foundry.utils.mergeObject(
    foundry.utils.deepClone(baseItem.system),
    foundry.utils.deepClone(enchantmentItem.system)
  )
  mergedItem.system.properties = Object.assign(
    {},
    baseItem.system.properties || {},
    enchantmentItem.system.properties
  )
  mergedItem.name = `${baseItem.name} ${enchantmentItem.name}`
  return mergedItem
}

// Helper function for fetchItems (needed by importCompositeItemWithEnchantment)
async function fetchItems(packId, names, lookupTable = {}, createPlaceholders = false) {
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

// Helper function for createPlaceholderItem (needed by fetchItems)
function createPlaceholderItem(name, packId) {
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