// Power-related helpers for import4e
// Exported functions: fetchPowers, fetchCorePowers, selectBestPowerMatch, findFuzzyPowerMatch, detectImplementExpertiseConditions, calculateImplementExpertiseBonus, modifyPowerWithImplementExpertiseBonus

import { lookup } from '../tools/lookup_tables.js';

export function detectImplementExpertiseConditions(equipment, feats, features, classes) {

  
  // Find all implement expertise feats
  const implementExpertiseFeats = feats.filter(feat => 
    feat.name.toLowerCase().includes("expertise") && 
    (feat.name.toLowerCase().includes("implement") || 
     feat.name.toLowerCase().includes("ki focus") ||
     feat.name.toLowerCase().includes("orb") ||
     feat.name.toLowerCase().includes("rod") ||
     feat.name.toLowerCase().includes("staff") ||
     feat.name.toLowerCase().includes("tome") ||
     feat.name.toLowerCase().includes("totem") ||
     feat.name.toLowerCase().includes("wand"))
  )
  

  
  // Check if character has any implement expertise feat
  const hasImplementExpertise = implementExpertiseFeats.length > 0


  // Check if character is a Monk or has Monk levels (including multiclass)
  const isMonk = classes.some(cls => 
    cls.toLowerCase().includes("monk") || 
    cls.toLowerCase().includes("hybrid monk")
  ) || feats.some(feat => 
    feat.name.toLowerCase().includes("multiclass monk") ||
    feat.name.toLowerCase().includes("master of the fist")
  )


  // Check if character has an implement equipped
  const hasImplementEquipped = equipment.some(item => 
    item.type === "weapon" && 
    item.system?.weaponType === "implement" &&
    item.system?.equipped === true
  )


  // Check if character has monk weapons equipped (including unarmed strike)
  const monkWeapons = ["club", "dagger", "javelin", "quarterstaff", "short sword", "shuriken", "sling", "spear", "unarmed strike"]
  const hasMonkWeaponEquipped = equipment.some(item => 
    item.type === "weapon" && 
    item.system?.equipped === true &&
    monkWeapons.some(weaponName => 
      item.name.toLowerCase().includes(weaponName)
    )
  )


  // Check if character has monk class features that enable weapon-as-implement
  const hasMonkWeaponImplementFeature = features.some(feature => 
    feature.name === "Monk Class" || 
    feature.name === "Hybrid Monk Class" ||
    feature.name.includes("Monastic Tradition") ||
    feature.name.includes("Unarmed Combatant")
  )


  // Determine if implement expertise bonus should be applied
  const shouldApplyImplementExpertiseBonus = hasImplementExpertise && 
    (hasImplementEquipped || (isMonk && hasMonkWeaponEquipped && hasMonkWeaponImplementFeature))



  return {
    hasImplementExpertise,
    isMonk,
    hasImplementEquipped,
    hasMonkWeaponEquipped,
    hasMonkWeaponImplementFeature,
    shouldApplyImplementExpertiseBonus,
    implementExpertiseFeats
  }
}

export function calculateImplementExpertiseBonus(implementExpertiseFeats, characterLevel) {
  if (!implementExpertiseFeats || implementExpertiseFeats.length === 0) {
    return 0
  }

  let highestBonus = 0
  for (const feat of implementExpertiseFeats) {
    let bonus = 0
    const desc = feat.system?.description?.value || ""
    // If the description includes +1, +2, +3, use level scaling
    if (desc.includes("+1") && desc.includes("+2") && desc.includes("+3")) {
      if (characterLevel >= 21) bonus = 3
      else if (characterLevel >= 11) bonus = 2
      else bonus = 1
    } else if (feat.name.includes("+1")) bonus = 1
    else if (feat.name.includes("+2")) bonus = 2
    else if (feat.name.includes("+3")) bonus = 3
    else if (feat.name.includes("+4")) bonus = 4
    else if (feat.name.includes("+5")) bonus = 5
    else if (feat.name.includes("+6")) bonus = 6
    else if (feat.name.includes("+7")) bonus = 7
    else if (feat.name.includes("+8")) bonus = 8
    else if (feat.name.includes("+9")) bonus = 9
    else if (feat.name.includes("+10")) bonus = 10
    else {
      // Try to parse from description
      const match = desc.match(/\+(\d+)/)
      if (match) {
        bonus = parseInt(match[1], 10)
      } else {
        bonus = 1
      }
    }
    if (bonus > highestBonus) {
      highestBonus = bonus
    }
  }
  return highestBonus
}

export function modifyPowerWithImplementExpertiseBonus(powerObj, implementExpertiseConditions, implementExpertiseBonus, equipment) {
  // Check if this is a monk power that would benefit from implement expertise
  const isMonkPower = powerObj.name.toLowerCase().includes("monk") ||
                     powerObj.name.toLowerCase().includes("basic attack") ||
                     // Check if it's a power that would benefit from implement expertise
                     powerObj.system?.attack?.ability === "wis" ||
                     powerObj.system?.attack?.ability === "dex" ||
                     powerObj.system?.attack?.ability === "str"

  if (!isMonkPower) {
    return powerObj
  }

  // Check if all implement expertise conditions are met
  if (!implementExpertiseConditions.shouldApplyImplementExpertiseBonus) {
    return powerObj
  }

  // Add weapon proficiency bonus + implement expertise feat bonus to attack formula
  if (powerObj.system?.attack?.formula) {
    const currentFormula = powerObj.system.attack.formula
    
    // Find the highest weapon proficiency bonus from equipped monk weapons
    const monkWeapons = ["club", "dagger", "javelin", "quarterstaff", "short sword", "shuriken", "sling", "spear", "unarmed strike"]
    let weaponProfBonus = 0
    const monkWeaponLog = []
    for (const item of equipment) {
      if (item.type === "weapon" && 
          item.system?.equipped === true &&
          monkWeapons.some(weaponName => item.name.toLowerCase().includes(weaponName))) {
        const profBonus = item.system?.profBonus || 0
        monkWeaponLog.push(`${item.name} (profBonus=${profBonus})`)
        if (profBonus > weaponProfBonus) {
          weaponProfBonus = profBonus
        }
      }
    }
    console.log("Equipped monk weapons:", monkWeaponLog)
    console.log("Highest monk weapon profBonus:", weaponProfBonus)
    console.log("Implement expertise bonus:", implementExpertiseBonus)
    const totalBonus = weaponProfBonus + implementExpertiseBonus
    console.log("Total bonus to add to formula:", totalBonus)
    if (totalBonus > 0) {
      powerObj.system.attack.formula = `${currentFormula} + ${totalBonus}`
    }
  }

  // Set weapon type to "any" for monk powers to allow implement usage
  if (powerObj.system?.weaponType && powerObj.system.weaponType !== "implement") {
    powerObj.system.weaponType = "any"
  }
  if (!powerObj.system?.weaponUse || powerObj.system.weaponUse === "none") {
    powerObj.system.weaponUse = "default"
  }

  // Add flag for tracking/debugging
  if (!powerObj.flags) powerObj.flags = {}
  if (!powerObj.flags.import4e) powerObj.flags.import4e = {}
  powerObj.flags.import4e.implementExpertiseCompat = true
  powerObj.flags.import4e.implementExpertiseBonus = implementExpertiseBonus

  return powerObj
}

export function selectBestPowerMatch(matches, classes) {
  if (matches.length === 1) return matches[0]
  
  // Sort by relevance to character's classes
  const scoredMatches = matches.map(match => {
    let score = 0
    const matchName = match.name.toLowerCase()
    
    for (const className of classes) {
      const classLower = className.toLowerCase()
      if (matchName.includes(classLower)) {
        score += 10
      }
      // Check for class-specific keywords
      if (classLower.includes("fighter") && matchName.includes("weapon")) score += 5
      if (classLower.includes("wizard") && matchName.includes("spell")) score += 5
      if (classLower.includes("cleric") && matchName.includes("divine")) score += 5
      if (classLower.includes("rogue") && matchName.includes("sneak")) score += 5
    }
    
    // Prefer shorter names (more specific)
    score += (20 - match.name.length)
    
    return { match, score }
  })
  
  scoredMatches.sort((a, b) => b.score - a.score)
  return scoredMatches[0].match
}

export function findFuzzyPowerMatch(powerName, index, classes) {
  const words = powerName.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const candidates = []
  
  for (const entry of index) {
    const entryWords = entry.name.toLowerCase().split(/\s+/)
    let score = 0
    
    for (const word of words) {
      for (const entryWord of entryWords) {
        const similarity = calculateSimilarity(word, entryWord)
        if (similarity > 0.7) {
          score += similarity
        }
      }
    }
    
    if (score > 0) {
      candidates.push({ entry, score })
    }
  }
  
  if (candidates.length === 0) return null
  
  candidates.sort((a, b) => b.score - a.score)
  return selectBestPowerMatch([candidates[0].entry], classes)
}

export function calculateSimilarity(str1, str2) {
  const distance = levenshteinDistance(str1, str2)
  const maxLength = Math.max(str1.length, str2.length)
  return maxLength === 0 ? 1 : (maxLength - distance) / maxLength
}

export function levenshteinDistance(str1, str2) {
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

export async function fetchPowers(powerNames, className, classes, equipment = [], feats = [], features = [], characterLevel = 1) {
  const pack = game.packs.get("dnd-4e-compendium.module-powers")
  if (!pack) {
    console.warn("Power compendium not found")
    return []
  }

  const implementExpertiseConditions = detectImplementExpertiseConditions(equipment, feats, features, classes)
  const implementExpertiseBonus = calculateImplementExpertiseBonus(implementExpertiseConditions.implementExpertiseFeats, characterLevel)

  const index = await pack.getIndex()
  const results = []
  const seenPowers = new Set()
  const seenPowerIds = new Set()

  for (const powerName of powerNames) {
    const resolvedName = lookup.power[powerName] || powerName
    let entry = index.find(e => e.name === resolvedName)
    if (!entry) {
      const pattern = new RegExp(resolvedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
      const matches = index.filter(e => e.name.match(pattern))
      if (matches.length > 0) {
        entry = selectBestPowerMatch(matches, classes)
      }
    }
    if (!entry) {
      const normalizedName = powerName.replace(/\s*\(.*?\)$/, "").trim()
      const pattern = new RegExp(normalizedName.replace(/[\(\)\[\]\+]/g, "\\$&"), "i")
      const matches = index.filter(e => e.name.match(pattern))
      if (matches.length > 0) {
        entry = selectBestPowerMatch(matches, classes)
      }
    }
    if (!entry) {
      entry = findFuzzyPowerMatch(resolvedName, index, classes)
    }
    if (entry) {
      const item = await pack.getDocument(entry._id)
      if (item) {
        const isDuplicate = seenPowers.has(item.name) || seenPowerIds.has(item._id)
        if (!isDuplicate) {
          const powerObj = item.toObject()
          const modifiedPower = modifyPowerWithImplementExpertiseBonus(powerObj, implementExpertiseConditions, implementExpertiseBonus, equipment)
          results.push(modifiedPower)
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

export async function fetchCorePowers(classes, equipment = [], feats = [], features = [], characterLevel = 1) {
  const pack = game.packs.get("dnd-4e-compendium.module-core-powers")
  if (!pack) {
    console.warn("Core power compendium not found")
    return []
  }
  const implementExpertiseConditions = detectImplementExpertiseConditions(equipment, feats, features, classes)
  const implementExpertiseBonus = calculateImplementExpertiseBonus(implementExpertiseConditions.implementExpertiseFeats, characterLevel)
  try {
    const allCorePowers = await pack.getDocuments()
    return allCorePowers.map(power => {
      const powerObj = power.toObject()
      return modifyPowerWithImplementExpertiseBonus(powerObj, implementExpertiseConditions, implementExpertiseBonus, equipment)
    })
  } catch (err) {
    console.error("Error fetching core powers:", err)
    return []
  }
} 