# Character Patch System

This directory contains character-specific patch files that allow you to override any values on imported characters. These patches are applied as the **final step** in the import process, making them the ultimate override for any hard-coded values.

## How It Works

1. Create a JSON file named after your character in this directory
2. The importer will automatically load and apply the patch after creating the character
3. Patches can override any actor property or item property

## File Naming

The importer tries multiple filename variations:
- `Character Name.json` (exact match)
- `character name.json` (lowercase)
- `character_name.json` (normalized - lowercase, no special chars, spaces as underscores)

## Patch File Structure

```json
{
  "actor": {
    "system.abilities.str.value": 18,
    "system.defences.ac.absolute": 22,
    "system.attributes.hp.value": 45,
    "system.attributes.hp.max": 45,
    "system.skills.ath.absolute": 15,
    "system.skills.ath.training": 5
  },
  "items": {
    "Item Name": {
      "system.equipped": true,
      "system.quantity": 2
    }
  }
}
```

## Actor Properties

Use dot notation to specify any actor property:
- `system.abilities.str.value` - Strength ability score
- `system.defences.ac.absolute` - Armor Class
- `system.attributes.hp.value` - Current Hit Points
- `system.attributes.hp.max` - Maximum Hit Points
- `system.skills.ath.absolute` - Athletics skill total
- `system.skills.ath.training` - Athletics training bonus

## Item Properties

Items are matched by name (case-insensitive):
- `system.equipped` - Whether item is equipped
- `system.quantity` - Item quantity
- `system.enhancement` - Enhancement bonus
- Any other item system property

## Example Use Cases

- Fix calculated values that the import process gets wrong
- Set specific equipment as equipped
- Override skill values for complex builds
- Force specific ability scores or defenses
- Set item quantities that weren't imported correctly

## Notes

- Patches are applied **after** all other import processing
- Only specify the properties you want to change
- Item names must match exactly (case-insensitive)
- The system will log what patches are being applied
- Missing patch files are ignored (no error) 