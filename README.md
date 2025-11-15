# Gooners Unite

Gooners around the world, I've got you covered.

![Lovense Control](https://i.imgur.com/Zyuiqts.jpeg)

This extension allows AI characters in SillyTavern to control your Lovense devices during gooning sessions, creating an immersive and interactive experience.

You're welcome.

[![My Discord](https://img.shields.io/badge/Discord-Join%20Server-7289da)](https://discord.com/invite/KdAkTg94ME)
[![Support Me](https://img.shields.io/badge/Ko--fi-Support%20Creator-ff5e5b)](https://ko-fi.com/marinara_spaghetti)

## 📥 Installation

### 1. Install the Extension

In SillyTavern:
1. Go to **Extensions** → **Install Extension**
2. Paste the repository URL: `https://github.com/SpicyMarinara/SillyTavern-Lovense`
3. Click **Install for all users/Install just for me**

### 2. Add Server Plugin

The extension needs a server-side proxy to communicate with Lovense Remote (to bypass browser CORS restrictions).

**Step 1: Enable server plugins** in your `config.yaml`:
```yaml
enableServerPlugins: true
```

![png](https://i.imgur.com/rmySG4N.png)

**Step 2: Copy the plugin file**

**Option A: Using File Explorer (Easy)**

1. Open your SillyTavern folder
2. Navigate to: `data/default-user/extensions/SillyTavern-Lovense/server/`
3. Copy the file `lovense.mjs`
4. Navigate to SillyTavern folder: `plugins/`
5. Paste the file there

**Option B: Using Command Line**

**Windows (PowerShell or Command Prompt):**
```batch
copy data\default-user\extensions\SillyTavern-Lovense\server\lovense.mjs plugins\
```

**Mac/Linux:**
```bash
cp data/default-user/extensions/SillyTavern-Lovense/server/lovense.mjs plugins/
```

**Step 3: Restart SillyTavern completely** - Close the server/launcher and start it again. The plugin will be automatically loaded.

You should see this message in the server console:
```
Loading Lovense Control server plugin...
Lovense Control server plugin loaded successfully
```

### 3. Setup Lovense Remote & Connect

See the [Setup](#setup) section below for PC or Mobile instructions.

---

## Setup

### Option 1: PC

1. Download and install **Lovense Remote** for your PC:
   - [Windows/Mac Download](https://www.lovense.com/app/remote)
   
2. Open Lovense Remote and pair your device via Bluetooth

3. Make sure Lovense Remote is running in the background

4. In SillyTavern: **Extensions** → **Lovense Control** → **Check Connection**

5. In the Lovense Remote app, allow the third-party to connect

6. Toggle **Enable Lovense Control** in the extension menu

**If you see Status: Connected, you're good to go!**

### Option 2: Mobile (Requires Same WiFi Network)

1. Download **Lovense Remote** app:
   - [iOS App Store](https://apps.apple.com/app/lovense-remote/id1273067916)
   - [Google Play](https://play.google.com/store/apps/details?id=com.lovense.remote)

2. Open Lovense Remote and pair your device via Bluetooth

3. **Important:** Make sure your phone and the PC running SillyTavern are on the **same WiFi network**

4. **Enable Game Mode:**
   - In Lovense Remote, go to **Discover → Game Mode**
   - Turn on **"Enable LAN"**

5. **Find your local IP:**
   - In the **Game Mode** tab, note the local IP address (looks like `192-168-1-44.lovense.club`)

6. In SillyTavern: **Extensions** → **Lovense Control** → **Advanced Connection Settings**

7. Enter your mobile's IP address and port (usually `34568`)

8. Click **Check Connection**

9. In the Lovense Remote app, allow the third-party to connect

10. Toggle **Enable Lovense Control** in the extension menu

**If you see Status: Connected, you're good to go!**

## ✨ How It Works

### AI Commands

When enabled, the extension injects a system prompt that teaches the AI how to control your device. The AI uses XML-style tags in its responses that are automatically hidden by SillyTavern:

#### Basic Commands

```xml
<lovense:vibrate intensity="10"/>        - Vibrate at intensity 10 (0-20)
<lovense:rotate intensity="15"/>         - Rotate at intensity 15 (0-20)
<lovense:pump intensity="2"/>            - Pump at intensity 2 (0-3)
<lovense:stop/>                          - Stop all activity
```

#### Preset Patterns

```xml
<lovense:preset name="pulse"/>           - Pulse pattern
<lovense:preset name="wave"/>            - Wave pattern
<lovense:preset name="fireworks"/>       - Fireworks pattern
<lovense:preset name="earthquake"/>      - Earthquake pattern
```

#### Advanced Commands

```xml
<lovense:vibrate intensity="15" duration="10"/>
    → Vibrate at intensity 15 for 10 seconds

<lovense:vibrate intensity="12" loop="5" pause="2" duration="20"/>
    → Vibrate at 12, run for 5s, pause for 2s, repeat for 20s total
```

**Note**: These commands are automatically hidden by SillyTavern (like HTML tags), so they won't clutter the chat display.

### Example Roleplay

**User**: *I lean in close and whisper something naughty*

**AI**: *I bite my lip, feeling a surge of excitement* <lovense:vibrate intensity="8" duration="5"/> Oh really? *I trail my fingers along your arm* That's quite the bold statement... <lovense:vibrate intensity="12" duration="3"/> *my breath quickens*

The commands are parsed by the extension and sent to your device while being automatically hidden from view in the chat.

***Works with both streaming off and on. When streaming is on, they commands will trigger during the generation process. When streaming is off, they are queued and played one after another after the message is displayed in your chat.***

## 🎨 Customization

### Prompt Template

You can customize how the AI is instructed about device control:

1. Go to Extensions → Lovense Control
2. Scroll to **AI Prompt Settings**
3. Edit the **Prompt Template**
4. Use `{{toyList}}` to insert the list of connected devices
5. Click **Reset to Default Prompt** to restore defaults

**Note:** The prompt is automatically injected at depth 0 as a system message.

## 📝 Testing

Use the built-in test controls to verify your device works:

1. **Test Vibrate**: 3-second vibration at 50% intensity
2. **Test Pulse Pattern**: 5-second pulse pattern
3. **Stop**: Immediately stop all activity

## 📱 Supported Devices

All Lovense devices supported by the Lovense Remote app:
- Vibrators (Lush, Hush, Domi, etc.)
- Rotating devices (Nora)
- Pumping devices (Max)
- And more

## � Troubleshooting

### "Not Connected" Status / HTTP 404 Error

**This means the server endpoint wasn't installed correctly.** You need to:

1. **Copy the server plugin file:**
   - Navigate to `data/default-user/extensions/SillyTavern-Lovense/server/`
   - Copy `lovense.mjs`
   - Paste it into the `plugins/` folder (in SillyTavern root directory)

2. **Enable server plugins** in `config.yaml`:
   ```yaml
   enableServerPlugins: true
   ```

3. **Restart SillyTavern completely**

4. **Check the console** - You should see:
   ```
   Loading Lovense Control server plugin...
   Lovense Control server plugin loaded successfully
   ```

5. Try "Check Connection" again

If still not working:
- Verify `lovense.mjs` exists in the `plugins/` folder
- On Windows, make sure the file is named `lovense.mjs` (not `lovense.mjs.txt`)
- Check the SillyTavern server console for error messages
- Make sure you restarted SillyTavern after copying the file

### Device Not Connecting

- Ensure **Lovense Remote** is running on your PC
- Check that your device is paired in Lovense Remote (shows as connected there)
- Make sure your device is powered on and nearby
- Try clicking "Check Connection" again
- If using custom IP/Port, verify the settings in Advanced Connection Settings

### Commands Not Working

- Make sure **Enable Lovense Control** is toggled ON
- Verify device connection status shows "Connected"
- Test with manual controls first
- Check browser console (F12) for error messages

### AI Not Using Commands

- The AI won't always use commands - it depends on context
- Try being more suggestive in your roleplay
- Check that the system prompt is being injected (Prompt Depth setting)
- Some models may be better at following instructions than others

## ⚙️ Privacy & Security

- All device communication happens **locally** on your computer
- No data is sent to external servers
- No developer account or API keys required
- No chat data is sent to Lovense servers
- Commands are only executed when you have the extension enabled

## 🎛️ API Documentation

For developers and advanced users, see the [Lovense Standard API Documentation](https://github.com/lovense/Standard_solutions).

## 📋 Known Limitations

- **Same Network Required (Mobile)**: When using mobile Lovense Remote, your phone and PC must be on the same WiFi network
- **Local Connection Only**: Extension connects locally - no remote/internet control
- **Single User**: Extension designed for single-user use

## 💖 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📜 License

This extension is provided as-is for use with SillyTavern. Please ensure you comply with Lovense's API terms of service.

## 🙏 Credits

- Main Developer is Marinara
- Built for [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- Uses [Lovense Standard Solutions API](https://github.com/lovense/Standard_solutions)

---

**Disclaimer**: This is a community-made extension for adult users only. By downloading it, you agree to be 18 or older. Use responsibly and at your own discretion. The developers are not responsible for any misuse or issues arising from the use of this extension.

Happy gooning!
