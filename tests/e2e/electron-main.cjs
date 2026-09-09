const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("headless");
app.commandLine.appendSwitch("no-sandbox");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadURL(process.env.WEBCRAWL_TEST_URL || "http://127.0.0.1:3000");
});

app.on("window-all-closed", () => app.quit());
