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

// Toy capability mappings
const TOY_CAPABILITIES = {
    // Rotating toys
    'nora': ['vibrate', 'rotate'],
    'diamo': ['vibrate', 'rotate'],
    'ridge': ['vibrate', 'rotate'],

    // Pumping toys
    'max': ['vibrate', 'pump'],
    'max 2': ['vibrate', 'pump'],

    // Thrusting toys
    'gravity': ['vibrate', 'thrusting'],
    'sex machine': ['vibrate', 'thrusting'],
    'mini sex machine': ['vibrate', 'thrusting'],

    // Fingering toys
    'flexer': ['vibrate', 'fingering'],

    // Suction toys
    'tenera': ['vibrate', 'suction'],
    'tenera 2': ['vibrate', 'suction'],

    // Oscillating toys
    'osci': ['vibrate', 'oscillate'],
    'osci 2': ['vibrate', 'oscillate'],
    'osci 3': ['vibrate', 'oscillate'],
};

// Settings with defaults
const defaultSettings = {
    enabled: false,
    connected: false,
    toys: {},
    local_ip: '127-0-0-1.lovense.club',
    local_port: '30010',
    guidelines: `1. Match intensity to context: gentle (1-10), moderate (11-15), intense (16-20)
2. Use commands that fit the scene naturally
3. Multiple commands per response allowed
4. Commands loop until your next response`,
};

// Lovense API state
let connectedToys = {};
let connectionCheckInterval = null;
let executedCommands = new Set(); // Track executed commands during streaming
let messageCommands = []; // Track all commands from the current message
let loopInterval = null; // Interval for looping commands
let currentLoopIndex = 0; // Current position in the loop
let streamingText = ''; // Accumulate streaming text
let isLooping = false; // Flag to control loop execution

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
 * Find toy ID by device name
 */
function findToyIdByName(deviceName) {
    const nameLower = deviceName.toLowerCase();
    for (const [id, toy] of Object.entries(connectedToys)) {
        const toyName = (toy.name || '').toLowerCase();
        const nickName = (toy.nickName || '').toLowerCase();
        if (toyName === nameLower || nickName === nameLower) {
            return id;
        }
    }
    return null;
}

/**
 * Parse AI response for Lovense commands
 */
function parseAICommands(text) {
    // Match <lovense:action param="value"/> or <lovense:action/>
    const commandRegex = /<lovense:(\w+)([^>]*?)\/>/gi;
    const commands = [];
    let match;

    while ((match = commandRegex.exec(text)) !== null) {
        const action = match[1]; // vibrate, rotate, pump, preset, stop, pattern
        const attributesStr = match[2];

        // Parse attributes
        const attrs = {};
        const attrRegex = /(\w+)="([^"]+)"/g;
        let attrMatch;

        while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
            attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
        }

        // Handle shorthand format: <lovense:vibrate="3"/> where the first value has no attribute name
        // Check if attributesStr starts with =" (shorthand format)
        const shorthandMatch = /^\s*="([^"]+)"/.exec(attributesStr);
        if (shorthandMatch) {
            attrs[action.toLowerCase()] = shorthandMatch[1];
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

            const duration = attrs.time || attrs.duration || 5;

            const presetObj = {
                command: 'Preset',
                name: presetName,
                timeSec: parseFloat(duration),
                apiVer: 1,
            };

            // Add device targeting if specified
            if (attrs.device) {
                const deviceName = attrs.device.toLowerCase();
                const toyId = findToyIdByName(deviceName);
                if (toyId) {
                    presetObj.toy = toyId;
                }
            }

            commands.push(presetObj);
            continue;
        }

        // Handle pattern commands
        if (action.toLowerCase() === 'pattern') {
            const strength = attrs.strength;
            if (!strength) continue;

            const duration = attrs.time || attrs.duration || 0;
            const interval = attrs.interval || 150;

            // Build rule string based on which functions are enabled
            const functions = [];
            if (attrs.vibrate === 'true' || attrs.vibrate === '1' || !attrs.vibrate) functions.push('v');
            if (attrs.rotate === 'true' || attrs.rotate === '1') functions.push('r');
            if (attrs.pump === 'true' || attrs.pump === '1') functions.push('p');
            if (attrs.thrusting === 'true' || attrs.thrusting === '1') functions.push('t');
            if (attrs.fingering === 'true' || attrs.fingering === '1') functions.push('f');
            if (attrs.suction === 'true' || attrs.suction === '1') functions.push('s');
            if (attrs.depth === 'true' || attrs.depth === '1') functions.push('d');
            if (attrs.oscillate === 'true' || attrs.oscillate === '1') functions.push('o');

            const rule = `V:1;F:${functions.join(',')};S:${interval}#`;

            commands.push({
                command: 'Pattern',
                rule: rule,
                strength: strength,
                timeSec: parseFloat(duration),
                apiVer: 2,
            });
            continue;
        }

        // Handle combo commands (vibrate + rotate + pump + thrusting + fingering + suction + depth + oscillate + stroke + all)
        if (action.toLowerCase() === 'combo') {
            const actions = [];

            if (attrs.vibrate) {
                const intensity = parseInt(attrs.vibrate);
                if (!isNaN(intensity)) {
                    actions.push(`Vibrate:${intensity}`);
                }
            }

            if (attrs.rotate) {
                const intensity = parseInt(attrs.rotate);
                if (!isNaN(intensity)) {
                    actions.push(`Rotate:${intensity}`);
                }
            }

            if (attrs.pump) {
                const intensity = parseInt(attrs.pump);
                if (!isNaN(intensity)) {
                    actions.push(`Pump:${intensity}`);
                }
            }

            if (attrs.thrusting) {
                const intensity = parseInt(attrs.thrusting);
                if (!isNaN(intensity)) {
                    actions.push(`Thrusting:${intensity}`);
                }
            }

            if (attrs.fingering) {
                const intensity = parseInt(attrs.fingering);
                if (!isNaN(intensity)) {
                    actions.push(`Fingering:${intensity}`);
                }
            }

            if (attrs.suction) {
                const intensity = parseInt(attrs.suction);
                if (!isNaN(intensity)) {
                    actions.push(`Suction:${intensity}`);
                }
            }

            if (attrs.depth) {
                const intensity = parseInt(attrs.depth);
                if (!isNaN(intensity)) {
                    actions.push(`Depth:${intensity}`);
                }
            }

            if (attrs.oscillate) {
                const intensity = parseInt(attrs.oscillate);
                if (!isNaN(intensity)) {
                    actions.push(`Oscillate:${intensity}`);
                }
            }

            if (attrs.stroke) {
                // Stroke can be a single value or a range like "0-50"
                actions.push(`Stroke:${attrs.stroke}`);
            }

            if (attrs.all) {
                const intensity = parseInt(attrs.all);
                if (!isNaN(intensity)) {
                    actions.push(`All:${intensity}`);
                }
            }

            if (actions.length === 0) continue;

            const duration = attrs.time || attrs.duration || 5;

            const commandObj = {
                command: 'Function',
                action: actions.join(','),
                timeSec: parseFloat(duration),
                apiVer: 1,
            };

            // Parse optional loop parameters
            if (attrs.loop) {
                commandObj.loopRunningSec = parseFloat(attrs.loop);
            }
            if (attrs.pause) {
                commandObj.loopPauseSec = parseFloat(attrs.pause);
            }

            // Add stopPrevious parameter if specified (default is 1)
            if (attrs.stopprevious !== undefined) {
                commandObj.stopPrevious = parseInt(attrs.stopprevious);
            }

            commands.push(commandObj);
            continue;
        }

        // Parse intensity for individual action commands
        // Support both old format (intensity="X") and new format (action="X")
        let intensity;
        let actionString;
        const actionLower = action.toLowerCase();

        if (actionLower === 'stroke') {
            // Stroke can be intensity or range (e.g., "0-50")
            actionString = attrs[actionLower] || attrs.intensity || attrs.range || '0-100';
        } else {
            // Try new format first (e.g., vibrate="15"), then fall back to old format (intensity="15")
            const intensityValue = attrs[actionLower] || attrs.intensity;
            if (!intensityValue) continue;

            intensity = parseInt(intensityValue);
            if (isNaN(intensity)) continue;
            actionString = intensity.toString();
        }

        // Parse duration - support both 'time' and 'duration'
        const duration = attrs.time || attrs.duration || 5;

        // Capitalize action name to match Lovense API requirements
        const capitalizedAction = action.charAt(0).toUpperCase() + action.slice(1).toLowerCase();

        const commandObj = {
            command: 'Function',
            action: `${capitalizedAction}:${actionString}`,
            timeSec: parseFloat(duration),
            apiVer: 1,
        };

        // Add device targeting if specified
        if (attrs.device) {
            const deviceName = attrs.device.toLowerCase();
            const toyId = findToyIdByName(deviceName);
            if (toyId) {
                commandObj.toy = toyId;
            }
        }

        // Parse optional loop parameters
        if (attrs.loop) {
            commandObj.loopRunningSec = parseFloat(attrs.loop);
        }
        if (attrs.pause) {
            commandObj.loopPauseSec = parseFloat(attrs.pause);
        }

        // Add stopPrevious parameter if specified (default is 1)
        if (attrs.stopprevious !== undefined) {
            commandObj.stopPrevious = parseInt(attrs.stopprevious);
        }

        commands.push(commandObj);
    }

    return commands;
}

/**
 * Start looping all commands from the current message
 */
function startLoopingCommands() {
    console.log('[Lovense] startLoopingCommands called, messageCommands:', messageCommands);

    // Clear any existing loop
    if (loopInterval) {
        clearInterval(loopInterval);
        loopInterval = null;
    }

    if (!messageCommands || messageCommands.length === 0) {
        console.log('[Lovense] No commands to loop');
        return;
    }

    // Filter out stop commands from the loop sequence
    const loopableCommands = messageCommands.filter(cmd => cmd.action !== 'Stop').map(cmd => {
        // Clone the command to avoid modifying the original
        const clonedCmd = { ...cmd };
        // Convert infinite loops (timeSec=0) to 30 seconds for sequential playback
        if (clonedCmd.timeSec === 0) {
            clonedCmd.timeSec = 30;
        }
        return clonedCmd;
    });

    if (loopableCommands.length === 0) {
        console.log('[Lovense] No loopable commands (only stop commands)');
        return;
    }

    console.log('[Lovense] Starting command loop with', loopableCommands.length, 'commands');
    currentLoopIndex = 0;
    isLooping = true;

    // Function to play next command in sequence
    const playNextCommand = async () => {
        if (!isLooping || loopableCommands.length === 0) return;

        const command = loopableCommands[currentLoopIndex];
        console.log('[Lovense] Playing looped command', currentLoopIndex + 1, 'of', loopableCommands.length, ':', command);

        await sendLovenseCommand(command, false, true);

        // Check again after async operation
        if (!isLooping) return;

        // Move to next command
        currentLoopIndex = (currentLoopIndex + 1) % loopableCommands.length;

        // Schedule the next command based on current command's duration
        const currentDuration = (command.timeSec || 5) * 1000;
        loopInterval = setTimeout(playNextCommand, currentDuration);
    };

    // Play the first command immediately
    playNextCommand();
}

/**
 * Stop looping commands
 */
function stopLoopingCommands() {
    // Set flag to stop loop
    isLooping = false;

    // Clear any loop interval/timeout
    if (loopInterval) {
        clearTimeout(loopInterval);
        loopInterval = null;
        console.log('[Lovense] Cleared command loop');
    }

    currentLoopIndex = 0;

    const settings = extension_settings[MODULE_NAME];

    if (!settings.connected) {
        return;
    }

    // Send a stop command to halt any activity (silently to avoid error spam)
    sendLovenseCommand({
        command: 'Function',
        action: 'Stop',
        timeSec: 0,
        apiVer: 1,
    }, false, true);

    console.log('[Lovense] Stopped looping commands');
}

/**
 * Handle streaming token received event
 * Executes commands in real-time as they appear during streaming
 */
async function onStreamTokenReceived(data) {
    const settings = extension_settings[MODULE_NAME];

    if (!settings.enabled || !settings.connected) {
        return;
    }

    // Accumulate the streaming text
    const token = typeof data === 'string' ? data : (data?.text || data?.message || '');
    if (!token) {
        return;
    }

    streamingText += token;

    // Parse all commands in the accumulated text
    const commands = parseAICommands(streamingText);

    // Execute commands in real-time as they appear during streaming
    for (const command of commands) {
        const commandKey = JSON.stringify(command);

        if (!executedCommands.has(commandKey)) {
            console.log('[Lovense] Executing command during streaming:', JSON.stringify(command));
            executedCommands.add(commandKey);
            messageCommands.push(command); // Add to message commands for looping later
            await sendLovenseCommand(command);
        }
    }
}

/**
 * Handle AI message received event
 * This serves as a fallback for when streaming is not enabled
 */
async function onMessageReceived(data) {
    const settings = extension_settings[MODULE_NAME];

    if (!settings.enabled || !settings.connected) {
        return;
    }

    // Handle both messageId (number) and event object formats
    const messageId = typeof data === 'number' ? data : data?.index;

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

    // Stop any existing loop
    stopLoopingCommands();

    // Clear previous message commands and executed commands
    messageCommands = [];
    executedCommands.clear();

    // Store commands for looping (don't execute them immediately)
    messageCommands = commands;

    // Start looping all commands from this message
    startLoopingCommands();
}

/**
 * Clear executed commands when generation starts
 */
function onGenerationStarted() {
    executedCommands.clear();
    messageCommands = []; // Clear commands from previous message
    streamingText = ''; // Clear streaming text accumulator
    // DON'T stop looping here - it will be stopped when new commands come in
    // Stopping here causes issues with swipe regeneration events
    console.log('[Lovense] Generation started - cleared state');
}

/**
 * Handle generation ended event to start looping
 */
function onGenerationEnded() {
    console.log('[Lovense] Generation ended -', messageCommands.length, 'commands detected');
    // Clear streaming text accumulator
    streamingText = '';
    // Stop any existing loop before starting a new one
    stopLoopingCommands();
    // Start looping all commands from the message when streaming ends
    startLoopingCommands();
}

/**
 * Generate dynamic prompt based on connected toys
 */
function generateDynamicPrompt() {
    if (!connectedToys || Object.keys(connectedToys).length === 0) {
        return '';
    }

    const settings = extension_settings[MODULE_NAME];

    // Collect all unique capabilities from connected toys
    const capabilities = new Set(['vibrate']); // All toys can vibrate
    const toyNames = [];
    const toyDetails = [];

    for (const toy of Object.values(connectedToys)) {
        const toyName = (toy.name || '').toLowerCase();
        const displayName = toy.name || 'Unknown';
        toyNames.push(displayName);

        // Collect device details
        const toyCaps = TOY_CAPABILITIES[toyName] || ['vibrate'];
        toyDetails.push({
            name: displayName,
            capabilities: toyCaps
        });

        toyCaps.forEach(cap => capabilities.add(cap));
    }

    // Build capabilities section
    const capabilityDescriptions = {
        'vibrate': '• Vibrate (0-20): ALL devices',
        'rotate': '• Rotate (0-20): Nora, Diamo, Ridge',
        'pump': '• Pump (0-3): Max, Max 2',
        'thrusting': '• Thrusting (0-20): Sex Machine, Mini Sex Machine, Gravity',
        'fingering': '• Fingering (0-20): Flexer',
        'suction': '• Suction (0-20): Tenera, Tenera 2',
        'depth': '• Depth (0-3): Automatically corresponds to vibrate',
        'oscillate': '• Oscillate (0-20): Osci series',
    };

    const capabilitiesText = Array.from(capabilities)
        .map(cap => capabilityDescriptions[cap])
        .filter(Boolean)
        .join('\n');

    // Build available commands section
    const commandDescriptions = {
        'vibrate': '<lovense:vibrate="X" time="Y"/> - Vibrate at X (0-20) for Y seconds',
        'rotate': '<lovense:rotate="X" time="Y"/> - Rotate at X (0-20) for Y seconds',
        'pump': '<lovense:pump="X" time="Y"/> - Pump at X (0-3) for Y seconds',
        'thrusting': '<lovense:thrusting="X" time="Y"/> - Thrust at X (0-20) for Y seconds',
        'fingering': '<lovense:fingering="X" time="Y"/> - Fingering at X (0-20) for Y seconds',
        'suction': '<lovense:suction="X" time="Y"/> - Suction at X (0-20) for Y seconds',
        'oscillate': '<lovense:oscillate="X" time="Y"/> - Oscillate at X (0-20) for Y seconds',
    };

    const commandsText = Array.from(capabilities)
        .map(cap => commandDescriptions[cap])
        .filter(Boolean)
        .join('\n');

    // Add special commands for thrusting devices
    const hasThrusting = capabilities.has('thrusting');
    const strokeCommand = hasThrusting ? '\n• Stroke (0-100): Used with Thrusting (requires 20+ point difference)' : '';
    const strokeExample = hasThrusting ? '\n<lovense:thrusting="10" stroke="0-50" time="10"/> - Thrust at 10 with stroke range 0-50 for 10 seconds' : '';

    // Build combo example with available capabilities
    const comboAttrs = Array.from(capabilities).slice(0, 2).map(cap => `${cap}="10"`).join(' ');

    const guidelines = settings.guidelines || defaultSettings.guidelines;

    // Add device targeting section if multiple devices are connected
    let deviceSection = '';
    if (toyDetails.length > 1) {
        deviceSection = `\n\nDevice Targeting:\nControl specific devices by adding device="name" parameter:\n`;
        for (const toy of toyDetails) {
            deviceSection += `• ${toy.name}: ${toy.capabilities.join(', ')}\n`;
        }
        deviceSection += `\nExample: <lovense:vibrate="10" time="5" device="${toyDetails[0].name}"/>\nOmit device parameter to control all devices simultaneously.`;
    }

    const prompt = `You can control the user's Lovense device during this conversation:
<lovense>
Connected devices: ${toyNames.join(', ')}

Capabilities:
${capabilitiesText}${strokeCommand}

Commands (use self-closing XML-style tags):
${commandsText}
<lovense:all="X" time="Y"/> - Activate all functions at X (0-20) for Y seconds
<lovense:preset name="NAME" time="Y"/> - Use preset (pulse, wave, fireworks, earthquake) for Y seconds
<lovense:pattern strength="X;X;X" interval="MS" time="Y"/> - Custom pattern (semicolon-separated 0-20 values)
<lovense:stop/> - Stop all activity

Multiple functions: Combine in one command
<lovense:${comboAttrs} time="10"/>${strokeExample}

Parameters:
loop="X" pause="Y" - Loop: X seconds on, Y seconds off
stopprevious="0" - Stack with previous commands (default: stop previous)${deviceSection}

Guidelines:
${guidelines}
</lovense>`;

    return prompt;
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

    const prompt = generateDynamicPrompt();

    setExtensionPrompt(
        EXTENSION_PROMPT_TAG,
        prompt,
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.SYSTEM
    );
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
    $('#lovense_local_ip').val(settings.local_ip || '127-0-0-1.lovense.club');
    $('#lovense_local_port').val(settings.local_port || '30010');
    $('#lovense_guidelines').val(settings.guidelines || defaultSettings.guidelines);

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

    // Guidelines textarea
    $('#lovense_guidelines').on('input', function () {
        extension_settings[MODULE_NAME].guidelines = $(this).val();
        saveSettingsDebounced();
        updatePrompt();
    });

    // Reset guidelines button
    $('#lovense_reset_guidelines').on('click', function () {
        $('#lovense_guidelines').val(defaultSettings.guidelines);
        extension_settings[MODULE_NAME].guidelines = defaultSettings.guidelines;
        saveSettingsDebounced();
        updatePrompt();
        toastr.success('Guidelines reset to default');
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

    // Stop all devices button
    $('#lovense_stop_all').on('click', async function () {
        // Stop looping
        stopLoopingCommands();

        // Clear all queued commands
        messageCommands = [];
        executedCommands.clear();
        streamingText = '';

        // Send stop command to all devices
        await sendLovenseCommand({
            command: 'Function',
            action: 'Stop',
            timeSec: 0,
            apiVer: 1,
        });

        toastr.success('All devices stopped and queue cleared');
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
