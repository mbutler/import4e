export function parseLanguages(languages, lookup) {
  const builtin = [];
  const script = [];
  const custom = [];
  for (const l of languages) {
    if (lookup.language && lookup.language[l]) {
      builtin.push(lookup.language[l]);
      if (lookup.script && lookup.script[l]) script.push(lookup.script[l]);
      else script.push("");
    } else {
      custom.push(l);
    }
  }
  return {
    spoken: { value: builtin, custom: custom.join("; ") },
    script: { value: script, custom: "" }
  };
}

export function parseVision(visionArr, lookup) {
  const vis = [["nv", ""]];
  visionArr.forEach(x => {
    const v = lookup.vision && lookup.vision[x];
    if (v) vis.push([v, ""]);
  });
  return vis;
}

export function isRitualName(name) {
  const ritualNames = [
    "Comprehend Language", "Comrades' Succor", "Simbul's Conversion", 
    "Magic Circle", "Brew Potion", "Make Whole", "Enchant Magic Item",
    "Linked Portal", "Sending", "Tenser's Floating Disk", "Water Walk"
  ];
  return ritualNames.some(ritualName => name.includes(ritualName));
} 