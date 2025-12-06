import {
    eventSource,
    event_types,
    extension_prompt_types,
    extension_prompt_roles,
    saveSettingsDebounced,
    setExtensionPrompt,
    getRequestHeaders,
} from '../../../../script.js';
import {
    extension_settings,
} from '../../../extensions.js';

const MODULE_NAME = 'lovense';
const EXTENSION_PROMPT_TAG = 'lovense_control';

// Default prompt template
const DEFAULT_PROMPT = `
You can control the user's Lovense device during this conversation, here are the manuals:
<lovense>
The user has these devices connected:
{{toyList}}
Use the following commands in your response when appropriate:
<lovense:vibrate intensity="X"/> - Vibrate at intensity X (0-20)
<lovense:rotate intensity="X"/> - Rotate at intensity X (0-20) (for compatible devices)
<lovense:pump intensity="X"/> - Pump at intensity X (0-3) (for compatible devices)
<lovense:preset name="NAME"/> - Use preset pattern (pulse, wave, fireworks, earthquake)
<lovense:stop/> - Stop all activity
You can add parameters to your commands, examples:
<lovense:vibrate intensity="15" duration="10"/> - Duration (vibrate at 15 for 10 seconds)
<lovense:vibrate intensity="12" loop="5" pause="2" duration="20"/> - Looped (vibrate at 12, 5s on, 2s off, for 20s total)
Important reminders about these commands:
1. Use them when they fit in the context (for instance, mirroring character actions).
2. Match intensity to the scene (gentle = 5-10, moderate = 11-15, intense = 16-20).
3. You can use multiple ones throughout the entire response, as the scene progresses.
4. The last command in your message will automatically continue until your next response.
</lovense>
`;

// Settings with defaults
const defaultSettings = {
    enabled: false,
    prompt_template: DEFAULT_PROMPT,
    connected: false,
    toys: {},
    local_ip: '127-0-0-1.lovense.club',
    local_port: '30010',
};

// Lovense API state
let connectedToys = {};
let connectionCheckInterval = null;
let executedCommands = new Set(); // Track executed commands during streaming
let lastCommand = null; // Track the last command sent

/**
 * Check connection to Lovense Remote
 */
async function checkConnection() {
    const settings = extension_settings[MODULE_NAME];
    const lovenseUrl = `https://${settings.local_ip}:${settings.local_port}/command`;

    try {
        // Use SillyTavern's proxy to avoid CORS issues with self-signed certificates
        const response = await fetch('/api/plugins/lovense/command', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                url: lovenseUrl,
                command: 'GetToys',
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.code === 200 && data.data && data.data.toys) {
            const toysData = typeof data.data.toys === 'string' ? JSON.parse(data.data.toys) : data.data.toys;
            connectedToys = toysData;
            settings.toys = toysData;
            settings.connected = true;
            saveSettingsDebounced();
            updateConnectionStatus();
            updatePrompt();
            return true;
        } else {
            settings.connected = false;
            connectedToys = {};
            updateConnectionStatus();
            return false;
        }
    } catch (error) {
        console.log('[Lovense] Not connected:', error.message);
        settings.connected = false;
        connectedToys = {};
        updateConnectionStatus();
        return false;
    }
}/**
 * Update connection status UI
 */
function updateConnectionStatus() {
    const settings = extension_settings[MODULE_NAME];
    const statusDiv = $('#lovense_status');
    const statusText = $('#lovense_status_text');
    const toysList = $('#lovense_toy_list');
    const toysSection = $('#lovense_toys_section');
    const testButtons = $('#lovense_test_controls button');

    if (settings.connected && connectedToys && Object.keys(connectedToys).length > 0) {
        statusDiv.removeClass('disconnected').addClass('connected');
        statusText.text('Connected');

        // Display connected toys
        toysList.empty();
        for (const [toyId, toy] of Object.entries(connectedToys)) {
            const toyItem = $('<li class="lovense_toy_item"></li>');
            toyItem.html(`
                <span class="lovense_toy_name">${toy.name || 'Unknown'} ${toy.nickName ? '(' + toy.nickName + ')' : ''}</span>
                <span class="lovense_toy_battery">Battery: ${toy.battery || 'N/A'}%</span>
            `);
            toysList.append(toyItem);
        }
        toysSection.show();
        testButtons.prop('disabled', false);
    } else {
        statusDiv.removeClass('connected').addClass('disconnected');
        statusText.text('Not Connected');
        toysSection.hide();
        testButtons.prop('disabled', true);
    }
}

/**
 * Send command to Lovense device(s)
 */
async function sendLovenseCommand(command, trackAsLast = true, silent = false) {
    const settings = extension_settings[MODULE_NAME];

    if (!settings.connected) {
        console.warn('[Lovense] Not connected to any device');
        return false;
    }

    try {
        const lovenseUrl = `https://${settings.local_ip}:${settings.local_port}/command`;

        // Use SillyTavern's proxy to avoid CORS issues
        const response = await fetch('/api/plugins/lovense/command', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                url: lovenseUrl,
                ...command,
            }),
        });

        const result = await response.json();
        console.log('[Lovense] Command sent:', command, 'Result:', result);

        // Track this as the last command if it's not a stop command and tracking is enabled
        if (trackAsLast && command.action !== 'Stop') {
            lastCommand = command;
            console.log('[Lovense] Tracked as last command:', lastCommand);
        }

        return result.code === 200;
    } catch (error) {
        // Only log and show errors if not silent
        if (!silent) {
            console.error('[Lovense] Error sending command:', error);
            toastr.error('Failed to send command to Lovense device');
        }
        return false;
    }
}

/**
 * Parse AI response for Lovense commands
 */
function parseAICommands(text) {
    // Match <lovense:action intensity="X" param="value"/> or <lovense:action/>
    const commandRegex = /<lovense:(\w+)([^>]*?)\/>/gi;
    const commands = [];
    let match;

    while ((match = commandRegex.exec(text)) !== null) {
        const action = match[1]; // vibrate, rotate, pump, preset, stop
        const attributesStr = match[2];

        // Parse attributes
        const attrs = {};
        const attrRegex = /(\w+)="([^"]+)"/g;
        let attrMatch;

        while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
            attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
        }

        if (action.toLowerCase() === 'stop') {
            commands.push({
                command: 'Function',
                action: 'Stop',
                timeSec: 0,
                apiVer: 1,
            });
            continue;
        }

        if (action.toLowerCase() === 'preset') {
            const presetName = (attrs.name || '').toLowerCase();
            if (!presetName) continue;

            const duration = attrs.duration !== undefined ? parseFloat(attrs.duration) : 5;

            commands.push({
                command: 'Preset',
                name: presetName,
                timeSec: duration,
                apiVer: 1,
            });
            continue;
        }

        // Parse intensity for vibrate, rotate, pump
        const intensity = parseInt(attrs.intensity);
        if (isNaN(intensity)) continue;

        // Parse duration - use 5 as default only if duration is not specified
        // Don't use || because duration="0" is valid (infinite loop)
        const duration = attrs.duration !== undefined ? parseFloat(attrs.duration) : 5;

        const commandObj = {
            command: 'Function',
            action: `${action}:${intensity}`,
            timeSec: duration,
            apiVer: 1,
        };

        // Parse optional loop parameters
        if (attrs.loop) {
            commandObj.loopRunningSec = parseFloat(attrs.loop);
        }
        if (attrs.pause) {
            commandObj.loopPauseSec = parseFloat(attrs.pause);
        }

        commands.push(commandObj);
    }

    return commands;
}

/**
 * Start looping the last command
 */
function startLoopingLastCommand() {
    console.log('[Lovense] startLoopingLastCommand called, lastCommand:', lastCommand);

    if (!lastCommand) {
        console.log('[Lovense] No last command to loop');
        return;
    }

    // Don't loop stop commands
    if (lastCommand.action === 'Stop') {
        console.log('[Lovense] Last command is Stop, not looping');
        return;
    }

    console.log('[Lovense] Starting infinite loop for last command:', lastCommand);

    // Create a looping version of the command that runs indefinitely
    const loopCommand = { ...lastCommand };

    // Set timeSec to 0 to loop indefinitely until stopped (per Lovense API docs)
    loopCommand.timeSec = 0;

    // Remove loop parameters when using infinite duration
    // Having both timeSec=0 and loop parameters can cause conflicts
    delete loopCommand.loopRunningSec;
    delete loopCommand.loopPauseSec;

    // Send the command to start looping indefinitely
    sendLovenseCommand(loopCommand, false);
}

/**
 * Stop looping the last command
 */
function stopLoopingLastCommand() {
    const settings = extension_settings[MODULE_NAME];

    if (!settings.connected) {
        return;
    }

    // Send a stop command to halt any infinite looping (silently to avoid error spam)
    sendLovenseCommand({
        command: 'Function',
        action: 'Stop',
        timeSec: 0,
        apiVer: 1,
    }, false, true);

    console.log('[Lovense] Stopped looping last command');
}

/**
 * Handle streaming token received event
 * Executes commands in real-time as they appear during streaming
 */
async function onStreamTokenReceived(text) {
    const settings = extension_settings[MODULE_NAME];

    if (!settings.enabled || !settings.connected) {
        return;
    }

    // Parse all commands in the current text
    const commands = parseAICommands(text);

    // Execute only new commands that haven't been executed yet
    for (const command of commands) {
        const commandKey = JSON.stringify(command);

        if (!executedCommands.has(commandKey)) {
            console.log('[Lovense] Executing command during streaming:', command);
            // Stop looping when a new command comes in
            stopLoopingLastCommand();
            executedCommands.add(commandKey);
            await sendLovenseCommand(command);
        }
    }
}

/**
 * Handle AI message received event
 * This serves as a fallback for when streaming is not enabled
 */
async function onMessageReceived(messageId) {
    const settings = extension_settings[MODULE_NAME];

    if (!settings.enabled || !settings.connected) {
        return;
    }

    const context = SillyTavern.getContext();
    const message = context.chat[messageId];

    if (!message || message.is_user) {
        return;
    }

    const messageText = message.mes || '';
    const commands = parseAICommands(messageText);

    if (commands.length === 0) {
        return;
    }

    console.log('[Lovense] Detected commands in AI message:', commands);

    // Execute commands (this handles the non-streaming case)
    for (const command of commands) {
        const commandKey = JSON.stringify(command);

        if (!executedCommands.has(commandKey)) {
            // Stop looping when a new command comes in
            stopLoopingLastCommand();
            executedCommands.add(commandKey);
            await sendLovenseCommand(command);
        }
    }

    // Clear the executed commands set for the next message
    executedCommands.clear();

    // Start looping the last command after all commands are executed
    startLoopingLastCommand();
}

/**
 * Clear executed commands when generation starts
 */
function onGenerationStarted() {
    executedCommands.clear();
    // Stop any looping when new generation starts
    stopLoopingLastCommand();
}

/**
 * Handle generation ended event to start looping
 */
function onGenerationEnded() {
    console.log('[Lovense] Generation ended, last command:', lastCommand);
    // Start looping the last command when streaming ends
    startLoopingLastCommand();
}

/**
 * Update the prompt injection
 */
function updatePrompt() {
    const settings = extension_settings[MODULE_NAME];

    if (!settings.enabled || !settings.connected) {
        setExtensionPrompt(EXTENSION_PROMPT_TAG, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        return;
    }

    // Build toy list for prompt with feature information
    let toyList = 'None connected';
    if (connectedToys && Object.keys(connectedToys).length > 0) {
        toyList = Object.values(connectedToys)
            .map(toy => {
                const features = [];

                // Determine supported features based on toy name/type
                // Most Lovense toys support vibration
                features.push('vibrate');

                // Rotating toys (Nora, Diamo)
                if (toy.name && /nora|diamo/i.test(toy.name)) {
                    features.push('rotate');
                }

                // Pumping toys (Max series)
                if (toy.name && /max/i.test(toy.name)) {
                    features.push('pump');
                }

                const featureStr = features.length > 0 ? ` - Supports: ${features.join(', ')}` : '';
                return `${toy.name || 'Unknown'} (Battery: ${toy.battery || 'N/A'}%)${featureStr}`;
            })
            .join('\n');
    }

    // Replace placeholders in prompt template
    const prompt = settings.prompt_template.replace(/\{\{toyList\}\}/g, toyList);

    // Inject at depth 0 as a SYSTEM message (right before generation)
    // This follows the same pattern as RPG Companion's "together" mode
    setExtensionPrompt(
        EXTENSION_PROMPT_TAG,
        prompt,
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.SYSTEM
    );

    console.log('[Lovense] Prompt injected at depth 0 as SYSTEM message');
}

/**
 * Initialize settings
 */
function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = { ...defaultSettings };
    }

    const settings = extension_settings[MODULE_NAME];

    // Restore settings to UI
    $('#lovense_enabled').prop('checked', settings.enabled);
    $('#lovense_prompt_template').val(settings.prompt_template || DEFAULT_PROMPT);
    $('#lovense_local_ip').val(settings.local_ip || '127-0-0-1.lovense.club');
    $('#lovense_local_port').val(settings.local_port || '30010');

    // Restore connection state
    if (settings.connected && settings.toys) {
        connectedToys = settings.toys;
    }

    updateConnectionStatus();
    updatePrompt();
}

/**
 * Setup UI event handlers
 */
function setupUI() {
    // Enable/disable toggle
    $('#lovense_enabled').on('change', function () {
        extension_settings[MODULE_NAME].enabled = $(this).prop('checked');
        saveSettingsDebounced();
        updatePrompt();

        // Start/stop connection checking
        if (extension_settings[MODULE_NAME].enabled) {
            startConnectionChecking();
        } else {
            stopConnectionChecking();
        }
    });

    // Local IP/Port settings
    $('#lovense_local_ip').on('input', function () {
        extension_settings[MODULE_NAME].local_ip = $(this).val();
        saveSettingsDebounced();
    });

    $('#lovense_local_port').on('input', function () {
        extension_settings[MODULE_NAME].local_port = $(this).val();
        saveSettingsDebounced();
    });

    // Prompt settings
    $('#lovense_prompt_template').on('input', function () {
        extension_settings[MODULE_NAME].prompt_template = $(this).val();
        saveSettingsDebounced();
        updatePrompt();
    });

    $('#lovense_reset_prompt').on('click', function () {
        $('#lovense_prompt_template').val(DEFAULT_PROMPT);
        extension_settings[MODULE_NAME].prompt_template = DEFAULT_PROMPT;
        saveSettingsDebounced();
        updatePrompt();
        toastr.success('Prompt reset to default');
    });

    // Connection
    $('#lovense_connect_button').on('click', async function () {
        toastr.info('Checking connection to Lovense Remote...');
        const connected = await checkConnection();
        if (connected) {
            toastr.success('Connected to Lovense device(s)!');
        } else {
            toastr.error('Could not connect. Make sure Lovense Remote is running and your device is paired.');
        }
    });

    // Test controls
    $('#lovense_test_vibrate').on('click', async function () {
        await sendLovenseCommand({
            command: 'Function',
            action: 'Vibrate:10',
            timeSec: 3,
            apiVer: 1,
        });
        toastr.info('Sent vibrate command (3 seconds at 50% intensity)');
    });

    $('#lovense_test_pulse').on('click', async function () {
        await sendLovenseCommand({
            command: 'Preset',
            name: 'pulse',
            timeSec: 5,
            apiVer: 1,
        });
        toastr.info('Sent pulse pattern (5 seconds)');
    });

    $('#lovense_test_stop').on('click', async function () {
        await sendLovenseCommand({
            command: 'Function',
            action: 'Stop',
            timeSec: 0,
            apiVer: 1,
        });
        toastr.info('Sent stop command');
    });
}

/**
 * Start periodic connection checking
 */
function startConnectionChecking() {
    if (connectionCheckInterval) {
        return; // Already running
    }

    // Check immediately
    checkConnection();

    // Then check every 10 seconds
    connectionCheckInterval = setInterval(() => {
        checkConnection();
    }, 10000);

    console.log('[Lovense] Started connection checking');
}

/**
 * Stop periodic connection checking
 */
function stopConnectionChecking() {
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
        console.log('[Lovense] Stopped connection checking');
    }
}

/**
 * Module initialization
 */
jQuery(async () => {
    // Load settings HTML manually since we're in data/default-user/extensions
    const settingsResponse = await fetch('/scripts/extensions/third-party/SillyTavern-Lovense/settings.html');
    const settingsHtml = await settingsResponse.text();
    $('#extensions_settings2').append(settingsHtml);

    // Load settings
    loadSettings();

    // Setup UI handlers
    setupUI();

    // Start connection checking if enabled
    if (extension_settings[MODULE_NAME]?.enabled) {
        startConnectionChecking();
    }

    console.log('[Lovense] Extension initialized successfully');

    // Listen for AI messages (fallback for non-streaming)
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    // Listen for streaming tokens (real-time command execution)
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived);

    // Clear command tracking when generation starts
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);

    // Start looping when generation ends
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);

    // Listen for chat changes to update prompt
    eventSource.on(event_types.CHAT_CHANGED, updatePrompt);
});
