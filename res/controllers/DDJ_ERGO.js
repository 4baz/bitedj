// DDJ ERGO
var DDJErgo = {};

// ── STATO LOOP E JUMP — PER DECK ─────────────────────────────────────────────
DDJErgo._loopSizes = [
    0.03125, 0.0625, 0.125, 0.25, 0.5,
    1, 2, 4, 8, 16, 32, 64, 128, 256, 512
];
DDJErgo._jumpSizes = [0.5, 1, 2, 4, 8, 16, 32];

DDJErgo._defaultLoopIdx = 7;  // 4 battute
DDJErgo._defaultJumpIdx = 3;  // 4 battute

DDJErgo._loopIdx = [7, 7, 7, 7];
DDJErgo._jumpIdx = [3, 3, 3, 3];

// ── SISTEMA MODALE PAD ────────────────────────────────────────────────────────
// Modalità per deck: 'hotcue' | 'loop' | 'looproll' | 'reserved'
DDJErgo._padMode = ['hotcue', 'hotcue', 'hotcue', 'hotcue'];

// Note MIDI dei 4 tasti Sample (modalità)
// Sample1=0x3C, Sample2=0x3E, Sample3=0x40, Sample4=0x42
DDJErgo._modeNotes = [0x3C, 0x3E, 0x40, 0x42];
DDJErgo._modeNames = ['hotcue', 'loop', 'looproll', 'reserved'];

// Note MIDI dei 4 pad
DDJErgo._padNotes = [0x2E, 0x2F, 0x30, 0x31];

// Indici in _loopSizes per i 4 pad loop (1/4=idx3, 1/2=idx4, 1=idx5, 2=idx6)
// _loopSizes: [0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, ...]
//                  0       1       2     3    4   5   6  7
DDJErgo._padLoopIndices = [3, 4, 5, 6];

// Dimensioni looproll fisse per i 4 pad (indipendenti dal knob)
DDJErgo._padRollSizes = [0.25, 0.5, 1, 2];

// Timer lampeggio per deck (0 = inattivo)
DDJErgo._blinkTimer   = [0, 0, 0, 0];
DDJErgo._blinkState   = [false, false, false, false];
DDJErgo._blinkPadNote = [0, 0, 0, 0];

// Helper: indice deck (0–3) dal group "[ChannelN]"
DDJErgo._deckIdx = function(group) {
    var m = group.match(/\[Channel(\d)\]/);
    if (m) return parseInt(m[1], 10) - 1;
    return 0;
};

// Helper: indice deck (0–3) dallo status MIDI
DDJErgo._deckIdxFromStatus = function(status) {
    return (status & 0x0F) % 4;
};

// ── HELPER: lampeggio pad loop ───────────────────────────────────────────────
// Avvia il lampeggio 250ms sul pad indicato. Ferma eventuali lampeggi precedenti.
DDJErgo._startBlinkPad = function(deckIdx, status, note) {
    DDJErgo._stopBlinkPad(deckIdx);
    DDJErgo._blinkPadNote[deckIdx] = note;
    DDJErgo._blinkState[deckIdx] = true;
    midi.sendShortMsg(status, note, 0x7F);
    DDJErgo._blinkTimer[deckIdx] = engine.beginTimer(250, (function(di, st, n) {
        return function() {
            DDJErgo._blinkState[di] = !DDJErgo._blinkState[di];
            midi.sendShortMsg(st, n, DDJErgo._blinkState[di] ? 0x7F : 0x00);
        };
    })(deckIdx, status, note));
};

DDJErgo._stopBlinkPad = function(deckIdx) {
    if (DDJErgo._blinkTimer[deckIdx] !== 0) {
        engine.stopTimer(DDJErgo._blinkTimer[deckIdx]);
        DDJErgo._blinkTimer[deckIdx] = 0;
    }
    // Spegne il pad che stava lampeggiando (se presente)
    // Il chiamante è responsabile di riaccenderlo se necessario
};

// ── HELPER: invia LED modalità — accende solo il tasto della modalità attiva ──
DDJErgo._sendModeLeds = function(deckIdx, status) {
    var mode = DDJErgo._padMode[deckIdx];
    for (var i = 0; i < DDJErgo._modeNames.length; i++) {
        var on = (DDJErgo._modeNames[i] === mode) ? 0x7F : 0x00;
        midi.sendShortMsg(status, DDJErgo._modeNotes[i], on);
    }
};

// ── HELPER: invia LED pad in base alla modalità corrente ─────────────────────
// In modalità loop il lampeggio è gestito da _startBlinkPad / _stopBlinkPad,
// questa funzione si occupa solo dei casi statici (hotcue, spegnimento).
DDJErgo._sendPadLeds = function(deckIdx, status, group) {
    var mode = DDJErgo._padMode[deckIdx];
    for (var p = 0; p < 4; p++) {
        var on = 0x00;
        if (mode === 'hotcue') {
            on = engine.getValue(group, 'hotcue_' + (p + 1) + '_status') ? 0x7F : 0x00;
        }
        // loop: gestito dal blink — non sovrascriviamo qui
        // looproll e reserved: tutti spenti (0x00)
        if (mode !== 'loop') {
            midi.sendShortMsg(status, DDJErgo._padNotes[p], on);
            midi.sendShortMsg(status, DDJErgo._padNotes[p] + 0x31, on);
        }
    }
};

// ── HELPER: aggiorna LED pad loop in base a _loopIdx ─────────────────────────
// Chiamato da loopKnobTurn quando siamo in modalità loop.
// Se il loopIdx corrente corrisponde a un pad, avvia/mantiene il lampeggio su quel pad.
// Se è fuori intervallo, ferma il lampeggio e spegne tutti i pad.
DDJErgo._updateLoopPadLeds = function(deckIdx, status) {
    var group = '[Channel' + (deckIdx + 1) + ']';
    var loopActive = engine.getValue(group, 'loop_enabled');

    if (!loopActive) {
        // Nessun loop attivo: ferma blink e spegne tutti i pad
        if (DDJErgo._blinkTimer[deckIdx] !== 0) {
            midi.sendShortMsg(status, DDJErgo._blinkPadNote[deckIdx], 0x00);
            DDJErgo._stopBlinkPad(deckIdx);
        }
        for (var p = 0; p < 4; p++) {
            midi.sendShortMsg(status, DDJErgo._padNotes[p], 0x00);
        }
        return;
    }

    // FIX: confronta la dimensione REALE del loop attivo con i valori dei pad,
    // non l'indice interno _loopIdx che potrebbe essere desincronizzato
    // in caso di loop manuale (loop_in/out) con durata non in array.
    var realSize = engine.getValue(group, 'beatloop_size');
    var padPos = -1;
    for (var i = 0; i < DDJErgo._padLoopIndices.length; i++) {
        if (DDJErgo._loopSizes[DDJErgo._padLoopIndices[i]] === realSize) {
            padPos = i;
            break;
        }
    }

    if (padPos >= 0) {
        var note = DDJErgo._padNotes[padPos];
        if (DDJErgo._blinkTimer[deckIdx] !== 0) {
            // Timer già attivo: se il pad è lo stesso non fare nulla,
            // se è cambiato spegni il precedente e avvia il nuovo
            if (DDJErgo._blinkPadNote[deckIdx] !== note) {
                midi.sendShortMsg(status, DDJErgo._blinkPadNote[deckIdx], 0x00);
                DDJErgo._startBlinkPad(deckIdx, status, note);
            }
            // stessa nota, blink già in corso → nessuna azione
        } else {
            // Nessun timer attivo: avvia sempre, senza condizioni
            DDJErgo._startBlinkPad(deckIdx, status, note);
        }
    } else {
        // Dimensione reale non corrisponde a nessun pad: ferma blink e spegne tutto
        if (DDJErgo._blinkTimer[deckIdx] !== 0) {
            midi.sendShortMsg(status, DDJErgo._blinkPadNote[deckIdx], 0x00);
            DDJErgo._stopBlinkPad(deckIdx);
        }
        for (var p = 0; p < 4; p++) {
            midi.sendShortMsg(status, DDJErgo._padNotes[p], 0x00);
        }
    }
};

// ── PRESSIONE TASTI MODALITÀ (Sample 1–4) ────────────────────────────────────
// Regola di blocco: non è possibile passare a modalità loop se un looproll
// è in corso, né passare a looproll se un loop normale è attivo.
// In caso di blocco, il LED del tasto premuto fa un flash breve per segnalare
// che il cambio non è stato accettato.
DDJErgo.modePress = function(channel, control, value, status, group) {
    if (value === 0) return;
    var idx = DDJErgo._deckIdx(group);

    var newMode = null;
    for (var i = 0; i < DDJErgo._modeNotes.length; i++) {
        if (control === DDJErgo._modeNotes[i]) {
            newMode = DDJErgo._modeNames[i];
            break;
        }
    }
    if (!newMode || newMode === 'reserved') return;

    var prevMode = DDJErgo._padMode[idx];
    var loopActive = engine.getValue(group, 'loop_enabled');

    // Regole di blocco cambio modalità:
    //
    // 1. Verso looproll: bloccato se loop_enabled=1, indipendentemente
    //    da dove si viene e da come il loop è stato attivato.
    // 2. Da looproll verso qualsiasi altra modalità: bloccato se loop_enabled=1
    //    (significa che un roll è fisicamente premuto in questo momento).
    // In tutti gli altri casi il cambio è libero.
    if (newMode === 'looproll' && loopActive) {
        DDJErgo._flashLedN(status, control, 8, 50);
        return;
    }
    if (prevMode === 'looproll' && loopActive) {
        DDJErgo._flashLedN(status, control, 8, 50);
        return;
    }

    DDJErgo._padMode[idx] = newMode;

    // Uscendo dalla modalità loop: ferma il lampeggio e spegne i pad
    if (prevMode === 'loop' && newMode !== 'loop') {
        midi.sendShortMsg(status, DDJErgo._blinkPadNote[idx], 0x00);
        DDJErgo._stopBlinkPad(idx);
        for (var p = 0; p < 4; p++) {
            midi.sendShortMsg(status, DDJErgo._padNotes[p], 0x00);
        }
    }

    DDJErgo._sendModeLeds(idx, status);
    DDJErgo._sendPadLeds(idx, status, group);

    // Entrando in modalità loop: se c'è già un loop attivo aggiorna subito i LED pad
    if (newMode === 'loop' && loopActive) {
        DDJErgo._updateLoopPadLeds(idx, status);
    }
};

// ── PRESSIONE PAD (hotcue / loop / looproll) ─────────────────────────────────
DDJErgo.padPress = function(channel, control, value, status, group) {
    var idx  = DDJErgo._deckIdx(group);
    var mode = DDJErgo._padMode[idx];

    var padIdx = DDJErgo._padNotes.indexOf(control);
    if (padIdx < 0) return;

    if (mode === 'hotcue') {
        var hcNum = padIdx + 1;
        engine.setValue(group, 'hotcue_' + hcNum + '_activate', value > 0 ? 1 : 0);

    } else if (mode === 'loop') {
        if (value === 0) return;

        // Il pad mappa a un indice preciso dell'array _loopSizes
        var targetLoopIdx = DDJErgo._padLoopIndices[padIdx];
        var size = DDJErgo._loopSizes[targetLoopIdx];
        var loopActive = engine.getValue(group, 'loop_enabled');

        if (loopActive && DDJErgo._loopIdx[idx] === targetLoopIdx) {
            // Stesso loop attivo → toggle off
            engine.setValue(group, 'reloop_exit', 1);
            engine.setValue(group, 'reloop_exit', 0);
            midi.sendShortMsg(status, control, 0x00);
            DDJErgo._stopBlinkPad(idx);
        } else {
            // Nuovo loop: disattiva quello corrente se attivo, avvia il nuovo
            if (loopActive) {
                engine.setValue(group, 'reloop_exit', 1);
                engine.setValue(group, 'reloop_exit', 0);
                // Spegne il pad precedente se era nell'intervallo
                var prevPadPos = DDJErgo._padLoopIndices.indexOf(DDJErgo._loopIdx[idx]);
                if (prevPadPos >= 0) {
                    midi.sendShortMsg(status, DDJErgo._padNotes[prevPadPos], 0x00);
                }
            }
            // Aggiorna loopIdx e attiva il loop
            DDJErgo._loopIdx[idx] = targetLoopIdx;
            engine.setValue(group, 'beatloop_size', size);
            engine.setValue(group, 'beatloop_' + size + '_activate', 1);
            engine.setValue(group, 'beatloop_' + size + '_activate', 0);
            DDJErgo._startBlinkPad(idx, status, control);
        }

    } else if (mode === 'looproll') {
        var rollSize = DDJErgo._padRollSizes[padIdx];
        if (value > 0) {
            engine.setValue(group, 'beatlooproll_' + rollSize + '_activate', 1);
            midi.sendShortMsg(status, control, 0x7F);
        } else {
            engine.setValue(group, 'beatlooproll_' + rollSize + '_activate', 0);
            midi.sendShortMsg(status, control, 0x00);
        }
    }
};

// ── PRESSIONE PAD SHIFT (clear hotcue — solo in modalità hotcue) ─────────────
DDJErgo.padShiftPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    var idx = DDJErgo._deckIdx(group);
    if (DDJErgo._padMode[idx] !== 'hotcue') return;

    // Le note shift sono 0x5F–0x62, offset +0x31 rispetto ai pad normali
    var padIdx = DDJErgo._padNotes.indexOf(control - 0x31);
    if (padIdx < 0) return;
    engine.setValue(group, 'hotcue_' + (padIdx + 1) + '_clear', 1);
    engine.setValue(group, 'hotcue_' + (padIdx + 1) + '_clear', 0);
};


// ── FX CHANNEL ENABLE — toggle con LED ──────────────────────────────────────
// 8 tasti su 0x96: note 0x4C–0x4F = FX Unit 1 per Ch1–4
//                  note 0x50–0x53 = FX Unit 2 per Ch1–4
DDJErgo._fxChannelMap = {
    0x4C: { unit: 1, ch: 1 },
    0x4D: { unit: 1, ch: 2 },
    0x4E: { unit: 1, ch: 3 },
    0x4F: { unit: 1, ch: 4 },
    0x50: { unit: 2, ch: 1 },
    0x51: { unit: 2, ch: 2 },
    0x52: { unit: 2, ch: 3 },
    0x53: { unit: 2, ch: 4 }
};

DDJErgo.fxChannelPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    var map = DDJErgo._fxChannelMap[control];
    if (!map) return;
    var fxGroup = '[EffectRack1_EffectUnit' + map.unit + ']';
    var key = 'group_[Channel' + map.ch + ']_enable';
    var current = engine.getValue(fxGroup, key);
    engine.setValue(fxGroup, key, current ? 0 : 1);
    midi.sendShortMsg(0x96, control, current ? 0x00 : 0x7F);
};

// ── FX PARAMETER BUTTONS — toggle, not momentary ─────────────────────────────
// The ERGO sends a press and release for these buttons. A normal XML binding
// would therefore turn the Mixxx effect off again as soon as the button is
// released. Keep the state until the next press, like the hardware's VDJ use.
DDJErgo.fxEffectPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    engine.setValue(group, 'enabled',
        engine.getValue(group, 'enabled') > 0 ? 0 : 1);
};

DDJErgo._fxSlotGroup = function(unitGroup, slot) {
    return unitGroup.replace(/\]$/, '_Effect' + slot + ']');
};

// FX ON toggles all loaded slots in the corresponding Mixxx effect unit.
// Mixxx effect units are routed through group_[ChannelN]_enable controls, so
// there is no single unit-level "enabled" control to bind this button to.
DDJErgo.fxUnitPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    var anyEnabled = false;
    for (var slot = 1; slot <= 3; slot++) {
        if (engine.getValue(DDJErgo._fxSlotGroup(group, slot), 'enabled') > 0) {
            anyEnabled = true;
            break;
        }
    }
    var next = anyEnabled ? 0 : 1;
    for (var i = 1; i <= 3; i++) {
        engine.setValue(DDJErgo._fxSlotGroup(group, i), 'enabled', next);
    }
    // The factory ERGO layout has one primary deck per FX section. If the
    // unit has no route at all, make the first press audible immediately;
    // the FX1/FX2 assignment buttons can still add or remove other decks.
    if (next) {
        var hasRoute = false;
        for (var deck = 1; deck <= 4; deck++) {
            if (engine.getValue(group, 'group_[Channel' + deck + ']_enable') > 0) {
                hasRoute = true;
                break;
            }
        }
        if (!hasRoute) {
            var primaryDeck = group === '[EffectRack1_EffectUnit2]' ? 2 : 1;
            engine.setValue(group,
                'group_[Channel' + primaryDeck + ']_enable', 1);
        }
    }
    DDJErgo._updateFxUnitLed(group === '[EffectRack1_EffectUnit2]' ? 0x95 : 0x94,
        group);
};

DDJErgo._updateFxUnitLed = function(status, unitGroup) {
    var on = false;
    for (var slot = 1; slot <= 3; slot++) {
        if (engine.getValue(DDJErgo._fxSlotGroup(unitGroup, slot), 'enabled') > 0) {
            on = true;
            break;
        }
    }
    midi.sendShortMsg(status, 0x43, on ? 0x7F : 0x00);
};

// Re-send the complete controller state after Mixxx has finished restoring
// its saved deck/effect state. The ERGO has no MIDI state-query command, so
// this synchronizes the hardware LEDs from Mixxx's state instead of guessing
// a physical position for a momentary button.
DDJErgo.refreshControllerState = function() {
    var groups = ['[Channel1]', '[Channel2]', '[Channel3]', '[Channel4]'];
    var statuses = [0x90, 0x91, 0x92, 0x93];
    var hotcueNotes = [0x2E, 0x2F, 0x30, 0x31];
    var clearHotcueNotes = [0x5F, 0x60, 0x61, 0x62];
    var pflNotes = [0x54, 0x55, 0x56, 0x57];

    for (var i = 0; i < groups.length; i++) {
        DDJErgo._sendDeckStateLed(groups[i], statuses[i], 'play_indicator', 0x0B);
        DDJErgo._sendDeckStateLed(groups[i], statuses[i], 'cue_indicator', 0x0C);
        DDJErgo._sendDeckStateLed(groups[i], statuses[i], 'loop_enabled', 0x10);
        DDJErgo._sendDeckStateLed(groups[i], statuses[i], 'loop_enabled', 0x11);
        DDJErgo._sendDeckStateLed(groups[i], statuses[i], 'keylock', 0x1A);
        DDJErgo._sendDeckStateLed(groups[i], statuses[i], 'sync_enabled', 0x58);
        DDJErgo._sendDeckStateLed(groups[i], statuses[i], 'sync_leader', 0x5C);
        DDJErgo._sendModeLeds(i, statuses[i]);
        DDJErgo._sendPadLeds(i, statuses[i], groups[i]);
        for (var n = 1; n <= 4; n++) {
            var led = DDJErgo._ledValue(
                engine.getValue(groups[i], 'hotcue_' + n + '_status'));
            midi.sendShortMsg(statuses[i], hotcueNotes[n - 1], led);
            midi.sendShortMsg(statuses[i], clearHotcueNotes[n - 1], led);
        }
        midi.sendShortMsg(0x96, pflNotes[i],
            DDJErgo._ledValue(engine.getValue(groups[i], 'pfl')));
    }

    DDJErgo._updateFxUnitLed(0x94, '[EffectRack1_EffectUnit1]');
    DDJErgo._updateFxUnitLed(0x95, '[EffectRack1_EffectUnit2]');
    for (var effect = 1; effect <= 3; effect++) {
        var note = 0x46 + effect;
        midi.sendShortMsg(0x94, note, DDJErgo._ledValue(
            engine.getValue('[EffectRack1_EffectUnit1_Effect' + effect + ']', 'enabled')));
        midi.sendShortMsg(0x95, note, DDJErgo._ledValue(
            engine.getValue('[EffectRack1_EffectUnit2_Effect' + effect + ']', 'enabled')));
    }
    for (var channel = 1; channel <= 4; channel++) {
        var route1 = engine.getValue('[EffectRack1_EffectUnit1]',
            'group_[Channel' + channel + ']_enable');
        var route2 = engine.getValue('[EffectRack1_EffectUnit2]',
            'group_[Channel' + channel + ']_enable');
        midi.sendShortMsg(0x96, 0x4B + channel, DDJErgo._ledValue(route1));
        midi.sendShortMsg(0x96, 0x4F + channel, DDJErgo._ledValue(route2));
    }
};

// ── LIVE LED FEEDBACK ────────────────────────────────────────────────────────
// The ERGO has single-color indicators, so use a clear on/off scheme: lit means
// the corresponding Mixxx state is active. Use makeConnection so changes made
// in Mixxx itself are reflected on the controller too.
DDJErgo._ledValue = function(value) {
    return value > 0 ? 0x7F : 0x00;
};

DDJErgo._connectDeckLed = function(group, status, control, note) {
    engine.makeConnection(group, control, function(value) {
        midi.sendShortMsg(status, note, DDJErgo._ledValue(value));
    });
};

DDJErgo._sendDeckStateLed = function(group, status, control, note) {
    midi.sendShortMsg(status, note,
        DDJErgo._ledValue(engine.getValue(group, control)));
};

DDJErgo.init = function() {
    var groups = ['[Channel1]', '[Channel2]', '[Channel3]', '[Channel4]'];
    var statuses = [0x90, 0x91, 0x92, 0x93];
    var hotcueNotes = [0x2E, 0x2F, 0x30, 0x31];
    var clearHotcueNotes = [0x5F, 0x60, 0x61, 0x62];

    for (var i = 0; i < groups.length; i++) {
        (function(group, st, deckIdx) {
            // Transport, cue, loop, keylock, Sync and master indicators.
            DDJErgo._connectDeckLed(group, st, 'play_indicator', 0x0B);
            DDJErgo._connectDeckLed(group, st, 'cue_indicator', 0x0C);
            DDJErgo._connectDeckLed(group, st, 'loop_enabled', 0x10);
            DDJErgo._connectDeckLed(group, st, 'loop_enabled', 0x11);
            DDJErgo._connectDeckLed(group, st, 'keylock', 0x1A);
            DDJErgo._connectDeckLed(group, st, 'sync_enabled', 0x58);
            DDJErgo._connectDeckLed(group, st, 'sync_leader', 0x5C);

            // Keep the loop-size pad feedback live for loops started elsewhere.
            engine.makeConnection(group, 'loop_enabled', function() {
                if (DDJErgo._padMode[deckIdx] === 'loop') {
                    DDJErgo._updateLoopPadLeds(deckIdx, st);
                }
            });

            // Automatically cue a deck as soon as a track is loaded. This
            // keeps the track audible in the ERGO headphones without needing
            // to press the physical CUE/PFL button every time.
            engine.makeConnection(group, 'track_loaded', function(value) {
                engine.setValue(group, 'pfl', value > 0 ? 1 : 0);
            });
            if (engine.getValue(group, 'track_loaded') > 0) {
                engine.setValue(group, 'pfl', 1);
            }

            // Hotcue LEDs use the current Mixxx 2.5 status controls.
            for (var n = 1; n <= 4; n++) {
                (function(hotcueNumber, hotcueNote, clearNote) {
                    var control = 'hotcue_' + hotcueNumber + '_status';
                    engine.makeConnection(group, control, function(value) {
                        var led = DDJErgo._ledValue(value);
                        midi.sendShortMsg(st, hotcueNote, led);
                        midi.sendShortMsg(st, clearNote, led);
                    });
                })(n, hotcueNotes[n - 1], clearHotcueNotes[n - 1]);
            }

            // Initialize the same states immediately on mapping load.
            DDJErgo._sendDeckStateLed(group, st, 'play_indicator', 0x0B);
            DDJErgo._sendDeckStateLed(group, st, 'cue_indicator', 0x0C);
            DDJErgo._sendDeckStateLed(group, st, 'loop_enabled', 0x10);
            DDJErgo._sendDeckStateLed(group, st, 'loop_enabled', 0x11);
            DDJErgo._sendDeckStateLed(group, st, 'keylock', 0x1A);
            DDJErgo._sendDeckStateLed(group, st, 'sync_enabled', 0x58);
            DDJErgo._sendDeckStateLed(group, st, 'sync_leader', 0x5C);

            // Beatjump indicators start off; the button flashes when used.
            midi.sendShortMsg(st, 0x4C, 0x00);
            midi.sendShortMsg(st, 0x4D, 0x00);

            DDJErgo._padMode[deckIdx] = 'hotcue';
            DDJErgo._blinkTimer[deckIdx] = 0;
            DDJErgo._blinkState[deckIdx] = false;
            DDJErgo._blinkPadNote[deckIdx] = 0;
            DDJErgo._sendModeLeds(deckIdx, st);
            DDJErgo._sendPadLeds(deckIdx, st, group);
        })(groups[i], statuses[i], i);
    }

    // PFL indicators follow each deck's headphone-cue state.
    var pflNotes = [0x54, 0x55, 0x56, 0x57];
    for (var d = 0; d < 4; d++) {
        (function(group, note) {
            engine.makeConnection(group, 'pfl', function(value) {
                midi.sendShortMsg(0x96, note, DDJErgo._ledValue(value));
            });
            midi.sendShortMsg(0x96, note,
                DDJErgo._ledValue(engine.getValue(group, 'pfl')));
        })('[Channel' + (d + 1) + ']', pflNotes[d]);
    }

    // Preview and recording indicators.
    engine.makeConnection('[PreviewDeck1]', 'play', function(value) {
        midi.sendShortMsg(0x96, 0x65, DDJErgo._ledValue(value));
    });
    midi.sendShortMsg(0x96, 0x65,
        DDJErgo._ledValue(engine.getValue('[PreviewDeck1]', 'play')));

    engine.makeConnection('[Recording]', 'status', function(value) {
        if (value > 0) {
            DDJErgo._startBlink();
        } else {
            DDJErgo._stopBlink();
        }
    });
    if (engine.getValue('[Recording]', 'status')) {
        DDJErgo._startBlink();
    } else {
        DDJErgo._sendRecLed(false);
    }

    // Individual FX and FX-channel assignment indicators.
    var fxNotes = [0x47, 0x48, 0x49];
    for (var fx = 1; fx <= 3; fx++) {
        (function(effectNumber, note) {
            var fx1 = '[EffectRack1_EffectUnit1_Effect' + effectNumber + ']';
            var fx2 = '[EffectRack1_EffectUnit2_Effect' + effectNumber + ']';
            engine.makeConnection(fx1, 'enabled', function(value) {
                midi.sendShortMsg(0x94, note, DDJErgo._ledValue(value));
                DDJErgo._updateFxUnitLed(0x94, '[EffectRack1_EffectUnit1]');
            });
            engine.makeConnection(fx2, 'enabled', function(value) {
                midi.sendShortMsg(0x95, note, DDJErgo._ledValue(value));
                DDJErgo._updateFxUnitLed(0x95, '[EffectRack1_EffectUnit2]');
            });
            midi.sendShortMsg(0x94, note,
                DDJErgo._ledValue(engine.getValue(fx1, 'enabled')));
            midi.sendShortMsg(0x95, note,
                DDJErgo._ledValue(engine.getValue(fx2, 'enabled')));
        })(fx, fxNotes[fx - 1]);
    }

    DDJErgo._updateFxUnitLed(0x94, '[EffectRack1_EffectUnit1]');
    DDJErgo._updateFxUnitLed(0x95, '[EffectRack1_EffectUnit2]');

    var fxChNotes1 = [0x4C, 0x4D, 0x4E, 0x4F];
    var fxChNotes2 = [0x50, 0x51, 0x52, 0x53];
    for (var ch = 1; ch <= 4; ch++) {
        (function(channelNumber, note1, note2) {
            var group = '[Channel' + channelNumber + ']';
            var unit1 = '[EffectRack1_EffectUnit1]';
            var unit2 = '[EffectRack1_EffectUnit2]';
            var control = 'group_' + group + '_enable';
            engine.makeConnection(unit1, control, function(value) {
                midi.sendShortMsg(0x96, note1, DDJErgo._ledValue(value));
            });
            engine.makeConnection(unit2, control, function(value) {
                midi.sendShortMsg(0x96, note2, DDJErgo._ledValue(value));
            });
            midi.sendShortMsg(0x96, note1,
                DDJErgo._ledValue(engine.getValue(unit1, control)));
            midi.sendShortMsg(0x96, note2,
                DDJErgo._ledValue(engine.getValue(unit2, control)));
        })(ch, fxChNotes1[ch - 1], fxChNotes2[ch - 1]);
    }

    // Run once after Mixxx restores saved controls and effect slots.
    engine.beginTimer(250, DDJErgo.refreshControllerState, true);

};

// ── LED FLASH per beatjump — 100ms ───────────────────────────────────────────
DDJErgo._flashLed = function(status, note) {
    midi.sendShortMsg(status, note, 0x7F);
    engine.beginTimer(100, function() {
        midi.sendShortMsg(status, note, 0x00);
    }, true);
};

// ── FLASH LED N VOLTE — feedback visivo per azione non consentita ────────────
// Esegue N lampeggi alla velocità indicata (ms per mezzo ciclo).
// Usa ricorsione via engine.beginTimer con oneShot=true.
DDJErgo._flashLedN = function(status, note, count, intervalMs, onDone) {
    if (count <= 0) {
        midi.sendShortMsg(status, note, 0x00);
        if (typeof onDone === 'function') onDone();
        return;
    }
    midi.sendShortMsg(status, note, 0x7F);
    engine.beginTimer(intervalMs, function() {
        midi.sendShortMsg(status, note, 0x00);
        engine.beginTimer(intervalMs, function() {
            DDJErgo._flashLedN(status, note, count - 1, intervalMs, onDone);
        }, true);
    }, true);
};

// ── LOOP KNOB L1 — ROTAZIONE ─────────────────────────────────────────────────
// Dual-mode:
// - Loop impostato via knob (o nessun loop attivo): naviga l'array e scrive beatloop_size
// - Loop impostato manualmente con loop_in/out: usa loop_double/loop_halve
//   sul valore reale e riallinea l'indice interno
DDJErgo.loopKnobTurn = function(channel, control, value, status, group) {
    var idx = DDJErgo._deckIdx(group);
    // Blocca completamente se un roll è attivo (modalità looproll + loop_enabled)
    if (DDJErgo._padMode[idx] === 'looproll' && engine.getValue(group, 'loop_enabled')) return;
    var loopActive = engine.getValue(group, 'loop_enabled');
    var currentSize = engine.getValue(group, 'beatloop_size');
    var expectedSize = DDJErgo._loopSizes[DDJErgo._loopIdx[idx]];
    var isManual = loopActive && (currentSize !== expectedSize);

    if (isManual) {
        // Loop manuale (loop_in/out): double/halve sul valore reale.
        // Dopo loop_double/halve Mixxx aggiorna beatloop_size in modo asincrono,
        // quindi aspettiamo 50ms prima di chiamare _updateLoopPadLeds, altrimenti
        // leggeremmo ancora il vecchio valore e il lampeggio non si aggiornerebbe.
        if (value >= 1 && value <= 63) {
            engine.setValue(group, 'loop_double', 1);
            engine.setValue(group, 'loop_double', 0);
            var newSize = Math.min(currentSize * 2, DDJErgo._loopSizes[DDJErgo._loopSizes.length - 1]);
            var newIdx = DDJErgo._loopSizes.indexOf(newSize);
            if (newIdx >= 0) DDJErgo._loopIdx[idx] = newIdx;
        } else {
            engine.setValue(group, 'loop_halve', 1);
            engine.setValue(group, 'loop_halve', 0);
            var newSize2 = Math.max(currentSize * 0.5, DDJErgo._loopSizes[0]);
            var newIdx2 = DDJErgo._loopSizes.indexOf(newSize2);
            if (newIdx2 >= 0) DDJErgo._loopIdx[idx] = newIdx2;
        }
        // Aggiorna LED pad con delay per attendere propagazione di beatloop_size
        if (DDJErgo._padMode[idx] === 'loop') {
            engine.beginTimer(50, (function(di, st) {
                return function() { DDJErgo._updateLoopPadLeds(di, st); };
            })(idx, 0x90 + idx), true);
        }
    } else {
        // Loop via knob/pad o nessun loop: naviga l'array
        if (value >= 1 && value <= 63) {
            if (DDJErgo._loopIdx[idx] < DDJErgo._loopSizes.length - 1)
                DDJErgo._loopIdx[idx]++;
        } else {
            if (DDJErgo._loopIdx[idx] > 0)
                DDJErgo._loopIdx[idx]--;
        }
        engine.setValue(group, 'beatloop_size', DDJErgo._loopSizes[DDJErgo._loopIdx[idx]]);
        // Aggiornamento LED pad sincrono: beatloop_size è già scritto sopra
        if (DDJErgo._padMode[idx] === 'loop') {
            DDJErgo._updateLoopPadLeds(idx, 0x90 + idx);
        }
    }
};

// ── LOOP KNOB L1 — PRESSIONE ─────────────────────────────────────────────────
// Il press disattiva il loop se attivo (o lo attiva se non attivo).
// Se siamo in modalità loop, spegne anche il lampeggio del pad.
DDJErgo.loopKnobPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    var idx = DDJErgo._deckIdx(group);
    // Blocca completamente se un roll è attivo
    if (DDJErgo._padMode[idx] === 'looproll' && engine.getValue(group, 'loop_enabled')) return;
    if (engine.getValue(group, 'loop_enabled')) {
        // Un loop è attivo: il press lo disattiva sempre
        engine.setValue(group, 'reloop_exit', 1);
        engine.setValue(group, 'reloop_exit', 0);
        if (DDJErgo._padMode[idx] === 'loop') {
            midi.sendShortMsg(0x90 + idx, DDJErgo._blinkPadNote[idx], 0x00);
            DDJErgo._stopBlinkPad(idx);
        }
    } else {
        // Nessun loop attivo: attiva il loop dal knob SOLO se non siamo in looproll
        if (DDJErgo._padMode[idx] === 'looproll') return;
        var size = engine.getValue(group, 'beatloop_size');
        engine.setValue(group, 'beatloop_' + size + '_activate', 1);
        engine.setValue(group, 'beatloop_' + size + '_activate', 0);
        if (DDJErgo._padMode[idx] === 'loop') {
            DDJErgo._updateLoopPadLeds(idx, 0x90 + idx);
        }
    }
};

// ── LOOP IN — con LED immediato ──────────────────────────────────────────────
// Al press accende subito il LED (nota 0x10 sul canale del deck).
// Il LED rimane acceso finché loop_enabled è attivo (gestito dall'output XML).
DDJErgo.loopIn = function(channel, control, value, status, group) {
    // Bloccato in modalità looproll: il loop manuale non è ammesso
    var idx = DDJErgo._deckIdx(group);
    if (DDJErgo._padMode[idx] === 'looproll') return;
    engine.setValue(group, 'loop_in', value > 0 ? 1 : 0);
    if (value > 0) {
        midi.sendShortMsg(status, 0x10, 0x7F);
    }
};

// ── LOOP OUT — bloccato in modalità looproll ────────────────────────────────
DDJErgo.loopOut = function(channel, control, value, status, group) {
    var idx = DDJErgo._deckIdx(group);
    if (DDJErgo._padMode[idx] === 'looproll') return;
    engine.setValue(group, 'loop_out', value > 0 ? 1 : 0);
};

// ── JUMP KNOB L2 — ROTAZIONE ─────────────────────────────────────────────────
DDJErgo.jumpKnobTurn = function(channel, control, value, status, group) {
    var idx = DDJErgo._deckIdxFromStatus(status);
    var deckGroup = '[Channel' + (idx + 1) + ']';
    if (value >= 1 && value <= 63) {
        if (DDJErgo._jumpIdx[idx] < DDJErgo._jumpSizes.length - 1)
            DDJErgo._jumpIdx[idx]++;
    } else {
        if (DDJErgo._jumpIdx[idx] > 0)
            DDJErgo._jumpIdx[idx]--;
    }
    engine.setValue(deckGroup, 'beatjump_size', DDJErgo._jumpSizes[DDJErgo._jumpIdx[idx]]);
};

// ── BEATJUMP BACKWARD ────────────────────────────────────────────────────────
DDJErgo.beatjumpBack = function(channel, control, value, status, group) {
    if (value === 0) return;
    var idx = DDJErgo._deckIdx(group);
    var size = DDJErgo._jumpSizes[DDJErgo._jumpIdx[idx]];
    engine.setValue(group, 'beatjump_' + size + '_backward', 1);
    engine.setValue(group, 'beatjump_' + size + '_backward', 0);
    DDJErgo._flashLed(status, 0x4C);
};

// ── BEATJUMP FORWARD ─────────────────────────────────────────────────────────
DDJErgo.beatjumpFwd = function(channel, control, value, status, group) {
    if (value === 0) return;
    var idx = DDJErgo._deckIdx(group);
    var size = DDJErgo._jumpSizes[DDJErgo._jumpIdx[idx]];
    engine.setValue(group, 'beatjump_' + size + '_forward', 1);
    engine.setValue(group, 'beatjump_' + size + '_forward', 0);
    DDJErgo._flashLed(status, 0x4D);
};

// ── RATE RANGE CYCLE (shift + keylock, nota 0x1B) ───────────────────────────
// Cicla il range del pitch fader tra i valori: 10% → 16% → 24% → 50% → 100%
// con wrap-around. Flash del LED keylock (0x1A) come conferma visiva.
DDJErgo._rateRanges = [0.10, 0.16, 0.24, 0.50, 1.00];

DDJErgo.rateRangeCycle = function(channel, control, value, status, group) {
    if (value === 0) return;
    var current = engine.getValue(group, 'rateRange');
    // Trova l'indice corrente (con tolleranza floating point)
    var idx = -1;
    for (var i = 0; i < DDJErgo._rateRanges.length; i++) {
        if (Math.abs(DDJErgo._rateRanges[i] - current) < 0.001) {
            idx = i;
            break;
        }
    }
    // Avanza al prossimo con wrap-around (se non trovato parte dal primo)
    var nextIdx = (idx + 1) % DDJErgo._rateRanges.length;
    engine.setValue(group, 'rateRange', DDJErgo._rateRanges[nextIdx]);
    // Lampeggio 3x sul LED 0x1B (il tasto L2 stesso, non il keylock L1)
    // Il LED keylock (0x1A) non viene toccato e mantiene il suo stato normale.
    DDJErgo._flashLedN(status, 0x1B, 3, 80);
};

// ── KEY KNOB — ROTAZIONE ─────────────────────────────────────────────────────
// pitch_up / pitch_down cambiano la tonalità di un semitono indipendentemente
// dal tempo e dal keylock. Si usano come controlli momentanei (1 poi 0).
DDJErgo.keyKnobTurn = function(channel, control, value, status, group) {
    if (!engine.getValue(group, 'keylock')) return;
    if (value >= 1 && value <= 63) {
        engine.setValue(group, 'pitch_up', 1);
        engine.setValue(group, 'pitch_up', 0);
    } else {
        engine.setValue(group, 'pitch_down', 1);
        engine.setValue(group, 'pitch_down', 0);
    }
};

// ── KEY KNOB — PRESSIONE (reset_key) ────────────────────────────────────────
// Se keylock OFF → non fa nulla. Se keylock ON → resetta alla chiave originale.
DDJErgo.keyKnobPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    if (!engine.getValue(group, 'keylock')) return;
    engine.setValue(group, 'reset_key', 1);
    engine.setValue(group, 'reset_key', 0);
};

// ── LOAD TRACK ───────────────────────────────────────────────────────────────
DDJErgo.loadTrack = function(channel, control, value, status, group) {
    if (value === 0) return;

    if (engine.getValue('[PreviewDeck1]', 'play')) {
        engine.setValue('[PreviewDeck1]', 'stop', 1);
        engine.setValue('[PreviewDeck1]', 'stop', 0);
        engine.setValue('[PreviewDeck1]', 'eject', 1);
        engine.setValue('[PreviewDeck1]', 'eject', 0);
    }

    var idx = DDJErgo._deckIdx(group);

    // Resetta lo stato modale e i LED immediatamente (non dipendono dal caricamento)
    DDJErgo._loopIdx[idx] = DDJErgo._defaultLoopIdx;
    DDJErgo._jumpIdx[idx] = DDJErgo._defaultJumpIdx;
    if (DDJErgo._blinkTimer[idx] !== 0) {
        midi.sendShortMsg(0x90 + idx, DDJErgo._blinkPadNote[idx], 0x00);
        DDJErgo._stopBlinkPad(idx);
    }
    DDJErgo._padMode[idx] = 'hotcue';
    var loadStatus = 0x90 + idx;
    DDJErgo._sendModeLeds(idx, loadStatus);
    DDJErgo._sendPadLeds(idx, loadStatus, group);

    // Prima carica la traccia, poi — con un delay di 200ms — imposta i valori
    // di beatloop_size, beatjump_size e azzera il loop fantasma.
    // Il delay è necessario perché Mixxx resetta questi valori internamente
    // durante il caricamento, sovrascrivendo qualsiasi cosa scritta prima.
    engine.setValue(group, 'LoadSelectedTrack', 1);
    engine.setValue(group, 'LoadSelectedTrack', 0);

    engine.beginTimer(200, (function(g, li, ji) {
        return function() {
            engine.setValue(g, 'beatloop_size', DDJErgo._loopSizes[li]);
            engine.setValue(g, 'beatjump_size', DDJErgo._jumpSizes[ji]);
            engine.setValue(g, 'loop_start_position', -1);
            engine.setValue(g, 'loop_end_position', -1);
        };
    })(group, DDJErgo._defaultLoopIdx, DDJErgo._defaultJumpIdx), true);
};

// ── EJECT TRACK (L2 LOAD) ────────────────────────────────────────────────────
DDJErgo.ejectTrack = function(channel, control, value, status, group) {
    if (value === 0) return;
    engine.setValue(group, 'eject', 1);
    engine.setValue(group, 'eject', 0);
};

// ── ENCODER LIBRERIA — track-table navigation ───────────────────────────────
// The Playlist control does not depend on which library pane currently has
// keyboard focus. This makes the ERGO browser reliable after using the deck,
// search box, or sidebar.
DDJErgo._browseDelta = function(value) {
    return value >= 1 && value <= 63 ? value : value - 128;
};

DDJErgo.libraryKnob = function(channel, control, value, status, group) {
    var delta = DDJErgo._browseDelta(value);
    if (delta === 0) return;
    var previewPlaying = engine.getValue('[PreviewDeck1]', 'play');
    if (previewPlaying) {
        var pos = engine.getValue('[PreviewDeck1]', 'playposition');
        pos = Math.max(0.0, Math.min(1.0, pos + delta * 0.010));
        engine.setValue('[PreviewDeck1]', 'playposition', pos);
    } else {
        engine.setValue('[Playlist]', 'SelectTrackKnob', delta);
    }
};

// Pioneer does not emit a separate MIDI message for the Shift key itself.
// Shift + browse sends CC 100 instead of the normal browse CC 64. Use that
// shifted stream for accelerated vertical navigation, not folder focus.
DDJErgo.libraryKnobFast = function(channel, control, value, status, group) {
    var delta = DDJErgo._browseDelta(value);
    if (delta === 0) return;
    var multiplier = 4;
    var previewPlaying = engine.getValue('[PreviewDeck1]', 'play');
    if (previewPlaying) {
        var pos = engine.getValue('[PreviewDeck1]', 'playposition');
        pos = Math.max(0.0, Math.min(1.0, pos + delta * 0.010 * multiplier));
        engine.setValue('[PreviewDeck1]', 'playposition', pos);
    } else {
        engine.setValue('[Playlist]', 'SelectTrackKnob', delta * multiplier);
    }
};

// ── PREVIEW DECK ─────────────────────────────────────────────────────────────
DDJErgo.previewPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    if (engine.getValue('[PreviewDeck1]', 'play')) {
        engine.setValue('[PreviewDeck1]', 'stop', 1);
        engine.setValue('[PreviewDeck1]', 'stop', 0);
        engine.setValue('[PreviewDeck1]', 'eject', 1);
        engine.setValue('[PreviewDeck1]', 'eject', 0);
    } else {
        engine.setValue('[PreviewDeck1]', 'LoadSelectedTrackAndPlay', 1);
        engine.setValue('[PreviewDeck1]', 'LoadSelectedTrackAndPlay', 0);
        engine.setValue('[PreviewDeck1]', 'pfl', 1);
    }
};

// ── RECORDING con LED lampeggiante ───────────────────────────────────────────
DDJErgo._recBlinkTimer = 0;
DDJErgo._recBlinkState = false;

DDJErgo._sendRecLed = function(on) {
    midi.sendShortMsg(0x96, 0x66, on ? 0x7F : 0x00);
};

DDJErgo._startBlink = function() {
    if (DDJErgo._recBlinkTimer !== 0) return;
    DDJErgo._recBlinkState = false;
    DDJErgo._recBlinkTimer = engine.beginTimer(500, function() {
        DDJErgo._recBlinkState = !DDJErgo._recBlinkState;
        DDJErgo._sendRecLed(DDJErgo._recBlinkState);
    });
};

DDJErgo._stopBlink = function() {
    if (DDJErgo._recBlinkTimer !== 0) {
        engine.stopTimer(DDJErgo._recBlinkTimer);
        DDJErgo._recBlinkTimer = 0;
    }
    DDJErgo._sendRecLed(false);
};

DDJErgo.recordPress = function(channel, control, value, status, group) {
    if (value === 0) return;
    var isRecording = engine.getValue('[Recording]', 'status');
    if (isRecording) {
        engine.setValue('[Recording]', 'toggle_recording', 1);
        engine.setValue('[Recording]', 'toggle_recording', 0);
        DDJErgo._stopBlink();
    } else {
        engine.setValue('[Recording]', 'toggle_recording', 1);
        engine.setValue('[Recording]', 'toggle_recording', 0);
        DDJErgo._startBlink();
    }
};

DDJErgo._syncGroups = ['[Channel1]', '[Channel2]', '[Channel3]', '[Channel4]'];

// Pick the same practical target a DJ expects from VirtualDJ: an existing
// sync leader first, otherwise another playing deck, otherwise another loaded
// deck with a valid BPM. This avoids Mixxx choosing Channel 1 just because it
// has the lowest number.
DDJErgo._findSyncTarget = function(group) {
    var i;
    for (i = 0; i < DDJErgo._syncGroups.length; i++) {
        var candidate = DDJErgo._syncGroups[i];
        if (candidate !== group && engine.getValue(candidate, 'sync_leader') > 0) {
            return candidate;
        }
    }
    for (i = 0; i < DDJErgo._syncGroups.length; i++) {
        var playing = DDJErgo._syncGroups[i];
        if (playing !== group &&
                engine.getValue(playing, 'play') > 0 &&
                engine.getValue(playing, 'bpm') > 0) {
            return playing;
        }
    }
    for (i = 0; i < DDJErgo._syncGroups.length; i++) {
        var loaded = DDJErgo._syncGroups[i];
        if (loaded !== group && engine.getValue(loaded, 'bpm') > 0) {
            return loaded;
        }
    }
    return null;
};

DDJErgo._setSyncLeader = function(group) {
    for (var i = 0; i < DDJErgo._syncGroups.length; i++) {
        engine.setValue(DDJErgo._syncGroups[i], 'sync_leader',
                DDJErgo._syncGroups[i] === group ? 1 : 0);
    }
};

// The ERGO Sync buttons send Note On/Off. Treat each press as a toggle:
// enabling Sync also aligns tempo and phase, while pressing again disables it.
// Mixxx's combined `beatsync` action can leave phase alignment dependent on
// Quantize, so explicitly pulse tempo and phase as separate actions.
DDJErgo.syncPress = function(channel, control, value, status, group) {
    if (value <= 0) return;

    if (engine.getValue(group, 'sync_enabled') > 0) {
        engine.setValue(group, 'sync_enabled', 0);
        return;
    }

    var target = DDJErgo._findSyncTarget(group);
    if (target !== null) {
        DDJErgo._setSyncLeader(target);
    }

    engine.setValue(group, 'sync_enabled', 1);
    engine.setValue(group, 'beatsync_tempo', 1);
    engine.setValue(group, 'beatsync_tempo', 0);
    engine.setValue(group, 'beatsync_phase', 1);
    engine.setValue(group, 'beatsync_phase', 0);
};

// Shift+Sync sends Note 0x5C on the ERGO. Set the selected deck as master,
// matching VirtualDJ's "set master" action. Clear the other deck master flags
// so there is always one unambiguous sync master.
DDJErgo.syncMasterPress = function(channel, control, value, status, group) {
    if (value <= 0) return;
    DDJErgo._setSyncLeader(group);
};

// The ERGO jog wheel reports a signed 7-bit value centered at 0x40 on CC 0x21.
// The same stream is used for scratching while the platter is touched and for
// pitch bending/nudging while it is not touched.
DDJErgo._jogSensitivityLeft = 0.30;
DDJErgo._jogSensitivityRight = 0.30;
DDJErgo._jogShiftSensitivityLeft = 3.00;
DDJErgo._jogShiftSensitivityRight = 3.00;
DDJErgo._jogTouching = [false, false];

DDJErgo._jogDelta = function(value, sensitivity) {
    return (value - 0x40) * sensitivity;
};

DDJErgo._jog = function(side, value, sensitivity, group) {
    var delta = DDJErgo._jogDelta(value, sensitivity);
    if (delta === 0) return;

    if (DDJErgo._jogTouching[side] && engine.isScratching(side + 1)) {
        engine.scratchTick(side + 1, delta);
    } else {
        engine.setValue(group, 'jog', delta);
    }
};

DDJErgo.jogLeft = function(channel, control, value, status, group) {
    DDJErgo._jog(0, value, DDJErgo._jogSensitivityLeft, group);
};

DDJErgo.jogRight = function(channel, control, value, status, group) {
    DDJErgo._jog(1, value, DDJErgo._jogSensitivityRight, group);
};

DDJErgo.jogShiftLeft = function(channel, control, value, status, group) {
    DDJErgo._jog(0, value, DDJErgo._jogShiftSensitivityLeft, group);
};

DDJErgo.jogShiftRight = function(channel, control, value, status, group) {
    DDJErgo._jog(1, value, DDJErgo._jogShiftSensitivityRight, group);
};

DDJErgo.jogPress = function(channel, control, value, status, group) {
    var side = group === '[Channel2]' ? 1 : 0;
    var deck = side + 1;

    if (value > 0) {
        if (DDJErgo._jogTouching[side]) return;
        DDJErgo._jogTouching[side] = true;
        engine.scratchEnable(deck, 720, 33 + 1 / 3, 1 / 8, 1 / 256);
    } else if (DDJErgo._jogTouching[side]) {
        DDJErgo._jogTouching[side] = false;
        engine.scratchDisable(deck);
    }
};

DDJErgo.shutdown = function() {
    DDJErgo._stopBlink();
    for (var jogSide = 0; jogSide < 2; jogSide++) {
        if (DDJErgo._jogTouching[jogSide]) {
            engine.scratchDisable(jogSide + 1);
        }
        DDJErgo._jogTouching[jogSide] = false;
    }
    // Ferma tutti i timer di lampeggio pad per tutti i deck
    for (var i = 0; i < 4; i++) {
        DDJErgo._stopBlinkPad(i);
    }
};
