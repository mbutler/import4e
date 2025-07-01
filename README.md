# Foundry VTT 4e Character Importer Module – Development Plan

## 🧠 Project Overview

**Project Name**: `import4e` (working title)  
**System**: Foundry VTT version 12+  
**Game System**: D&D 4e (via [dnd4e system](https://github.com/graveandhonor/dnd4e))  
**Dependency**: Full compatibility with the existing `dnd-4e-compendium` and its structure

## 🎯 Project Goals

### ✅ Primary Objective:
Build a standalone Foundry module that imports `.dnd4e` character files (from D&D Insider Character Builder) into fully compatible **4e Actor documents** in Foundry.

### 📍 Requirements:
- Full compatibility with the **existing 4e system and compendium structure**
- Modular, testable, iterative development
- Maximum reuse of assets like `lookup_tables.js` from original tools
- Rapid development–test cycles with clean debugging
- MVP-first delivery, then incremental enhancement
- Clean UI for file selection and import confirmation

## 🏗️ Architecture & Files

### Module Folder Structure (MVP Stage)

```
import4e/
├── module.json
├── main.js
├── app/
│   └── ImporterApp.js
├── templates/
│   └── importer-dialog.hbs
└── tools/
    └── lookup_tables.js
```

## 📦 Core External Dependencies

- `dnd-4e-compendium.module-*` compendiums
- Foundry VTT `game.packs` APIs
- System-defined actor type: `"Player Character"`

## ✅ MVP Features (Working)

- UI form with `.dnd4e` file upload
- XML parsing using `DOMParser`
- Extracting:
  - Name
  - Level
  - Class
  - Race
  - Abilities (STR/CON/DEX/INT/WIS/CHA)
- Fuzzy-matched import of:
  - Feats
  - Class features
- Compendium compatibility
- Logging for missing items
- Fallback names to avoid crashes

## 🔜 Next Planned Features

### Tier 1: High Value, Low Complexity
- Import **class**, **race**, **theme**, **background**
- Import **powers** from power compendiums
- Import **equipment**, **weapons**, **armor**
- Import **rituals**, **treasures**

### Tier 2: Medium Complexity
- Import and map **skills** and **proficiencies**
- Merge duplicate powers
- Import **implements**, **weapon focus**
- Power enhancements from feats

### Tier 3: Advanced Features
- UI to choose replace/merge
- Compendium creation tools
- Custom token images
- Re-import capability
- Integration with chat/effect utilities

## 🔁 Design Principles

- Modular, minimal at each stage
- Built for iteration and debugging
- Fail-safe with logs for missing content
- Extensible clean code structure
- Respects Foundry V12+ API norms

## ⚠️ Known Issues or Limitations

- Some items (e.g., “Arcanist Cantrips”) may not exist in compendium
- Suffix-matching logic needed
- Name fallback guards in place

## 🔍 Implementation Notes

### `_fetchItems()`:
- Supports exact, fuzzy, and lookup alias matching

### `_getDetails()`:
- Handles `<Details>` and `<Stat alias>`
- Includes fallback defaults

## 🛠 Next Development Steps

1. Fix `_getRulesElements` to return arrays
2. Re-add power importing
3. Add equipment handling
4. Support re-import/update
5. Test harness/dev-mode tooling
6. Extend UI with options

## 🧩 Helpful Dev Utilities

```js
game.packs.map(p => p.metadata.id)
game.reload()
CONFIG.Actor.documentClass.metadata.types
```

## ✅ Status Snapshot

| Feature                  | Status    |
|--------------------------|-----------|
| UI file input            | ✅ Working |
| XML parsing              | ✅ Working |
| Basic actor creation     | ✅ Working |
| Feats & features import  | ✅ Working |
| Class, race, stats       | ✅ Working |
| Fuzzy compendium match   | ✅ Working |
| Powers, equipment        | 🔜 Next   |
| Re-import/update         | ❌ Planned |
| Error-free operation     | ⚠️ Nearly |

--

## Key Fixes Made

### **XML Parsing & Data Extraction**
- **Defense spelling**: Fixed "defences" vs "defenses" in XML parsing
- **Power name spaces**: Added fuzzy matching to handle errant spaces in power names
- **Hybrid class support**: Added proper parsing for hybrid characters with multiple classes
- **XP parsing**: Fixed to read from `<Details><Experience>` tag and store in `system.details.exp`

### **Power Importing**
- **Fuzzy matching**: Implemented Levenshtein distance matching for power names with typos/variations
- **Pattern matching**: Added regex-based matching for powers with parentheses and special characters
- **Class-aware selection**: Prioritized class-specific powers over generic ones
- **Core powers**: Added automatic import of basic class powers (at-will, basic attacks)
- **Deduplication**: Prevented duplicate powers by tracking both names and compendium IDs

### **Equipment & Items**
- **Composite items**: Handled base items + enchantments (e.g., "Cloth Armor +3")
- **Ritual importing**: Added support for ritual items with proper categorization
- **Special items**: Added import of special character items
- **Placeholder creation**: Created placeholder items for missing compendium entries
- **Cross-category deduplication**: Removed duplicates across feats, features, powers, equipment, etc.

### **Defense Values**
- **Direct property assignment**: Used `actor.system.defences.ac.value = 28` instead of `actor.update()` to prevent system recalculation
- **XML value preservation**: Ensured defense values from .dnd4e file override automatic calculations

### **Character Details**
- **Level, class, race**: Proper parsing and assignment
- **Abilities**: Correct stat parsing with fallback aliases
- **Hit points, healing surges, initiative, speed**: All properly imported
- **Paragon paths & epic destinies**: Added support for high-level characters

### **Error Handling & Debugging**
- **Detailed logging**: Added comprehensive console output for troubleshooting
- **Graceful failures**: Items not found create placeholders instead of breaking import
- **Validation**: Checks for required data before proceeding

The importer now handles all character types, provides robust fuzzy matching, and preserves the exact values from the .dnd4e files while working with the D&D 4e system's automatic calculations.
