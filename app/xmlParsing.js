export function getDetails(xml) {
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
  const getRulesArray = (type) => Object.values(getRulesElements(xml, type))
  const className = Object.values(getRulesElements(xml, "Class"))[0] || ""
  let displayClass = className;
  let classes = [className];
  if (className === "Hybrid") {
    const hybridClasses = Object.values(getRulesElements(xml, "Hybrid Class")).map(c => c.replace(/^Hybrid /, ""));
    if (hybridClasses.length > 0) {
      displayClass = hybridClasses.join("|");
      classes = hybridClasses;
    }
  }
  const raceName = Object.values(getRulesElements(xml, "Race"))[0] || ""
  const paragonPathName = Object.values(getRulesElements(xml, "Paragon Path"))[0] || ""
  const epicDestinyName = Object.values(getRulesElements(xml, "Epic Destiny"))[0] || ""
  const subraceName = Object.values(getRulesElements(xml, "Subrace"))[0] || ""
  const backgroundName = Object.values(getRulesElements(xml, "Background"))[0] || ""
  const themeName = Object.values(getRulesElements(xml, "Theme"))[0] || ""
  const deityName = Object.values(getRulesElements(xml, "Deity"))[0] || ""
  const visionName = Object.values(getRulesElements(xml, "Vision"))[0] || ""
  const languages = getRulesArray("Language")
  const weaponProfs = getRulesArray("Proficiency").filter(p => p.includes("Weapon Proficiency"))
  const armorProfs = getRulesArray("Proficiency").filter(p => p.includes("Armor Proficiency") || p.includes("Shield Proficiency"))
  // Map proficiencies using lookup table
  const weaponProfsMapped = weaponProfs.map(p => {
    const match = p.match(/Weapon Proficiency \((.*)\)/)
    return match ? match[1] : p
  })
  const armorProfsMapped = armorProfs.map(p => {
    const match = p.match(/(Armor|Shield) Proficiency \((.*)\)/)
    return match ? match[2] : p
  })
  // Map languages using lookup table if available
  const languagesMapped = languages.map(l => l)
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
    class: displayClass,
    classes: classes,
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

export function getSkills(xml) {
  const skills = {}
  xml.querySelectorAll('StatBlock > Stat').forEach(stat => {
    const alias = stat.querySelector('alias')
    if (!alias) return
    const skillName = alias.getAttribute('name')
    const skillValue = Number(stat.getAttribute('value')) || 0
    if (skillName && !skillName.includes(' Trained') && !skillName.includes(' Misc') && !skillName.includes(' Penalty')) {
      const skillId = mapSkillNameToId(skillName)
      if (skillId) {
        const ability = getSkillAbility(skillName)
        const isTrained = xml.querySelector(`RulesElementTally > RulesElement[type="Skill Training"][name="${skillName}"]`) !== null
        skills[skillId] = {
          value: 0,
          base: 0,
          training: isTrained ? 5 : 0,
          ability: ability,
          absolute: skillValue,
          total: skillValue,
          bonus: [{}],
          chat: `@name uses @label.`,
          armourCheck: isArmorCheckSkill(skillName),
          feat: 0,
          item: 0,
          power: 0,
          untyped: 0,
          effectBonus: 0
        }
      }
    }
  })
  return skills
}

export function mapSkillNameToId(skillName) {
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

export function getSkillAbility(skillName) {
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

export function isArmorCheckSkill(skillName) {
  const armorCheckSkills = ['Acrobatics', 'Athletics', 'Endurance', 'Stealth', 'Thievery']
  return armorCheckSkills.includes(skillName)
}

export function getRulesElements(xml, type) {
  const results = {}
  xml.querySelectorAll(`RulesElementTally > RulesElement[type="${type}"]`).forEach(elem => {
    results[elem.getAttribute("charelem")] = elem.getAttribute("name")
  })
  return results
}

export function getPowerNames(xml) {
  const powers = getRulesElements(xml, "Power")
  const powersObsolete = {}
  const powersRetained = []
  xml.querySelectorAll("RulesElement[type='Power'][replaces]").forEach(elem => {
    const obsolete = elem.getAttribute("replaces")
    powersObsolete[obsolete] = powers[obsolete]
  })
  Object.keys(powers).forEach(id => {
    if (!powersObsolete[id]) {
      const powerName = powers[id]
      if (!isBasicAttack(powerName)) {
        powersRetained.push(powerName)
      }
    }
  })
  return powersRetained
}

export function isBasicAttack(powerName) {
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

export function getHeritageFeatures(xml) {
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

export function getClassFeatures(xml) {
  const features = []
  const tally = xml.querySelectorAll('RulesElementTally > RulesElement[type="Class Feature"]')
  tally.forEach(node => {
    const name = node.getAttribute('name')
    if (name) features.push(name)
  })
  return features
}

export function getLoot(xml) {
  const elements = []
  const allLootElements = xml.querySelectorAll("LootTally > loot")
  allLootElements.forEach((loot, index) => {
    const count = loot.getAttribute("count")
    const equipCount = loot.getAttribute("equip-count")
    if (count !== "0") {
      const components = getLootComponents(loot)
      if (components.length > 0) {
        elements.push(components)
      }
    }
  })
  return elements
}

export function getLootComponents(loot) {
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