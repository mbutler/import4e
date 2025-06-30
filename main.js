import { ImporterApp } from './app/ImporterApp.js'

Hooks.once('init', () => {
  console.log("import4e | Initializing 4E Character Importer")
})

Hooks.once('ready', async () => {
  console.log("import4e | Ready")
})

Hooks.on("renderActorDirectory", async (app, html, data) => {
  const button = $(
    `<button class="import4e-button"><i class="fas fa-file-import"></i> 4E Import</button>`
  )

  button.on("click", () => {
    new ImporterApp().render(true)
  })

  const footer = html.find(".directory-footer")
  if (footer.length) {
    footer.append(button)
  } else {
    // fallback: inject at top of directory
    html.find(".directory-header").append(button)
  }
})

