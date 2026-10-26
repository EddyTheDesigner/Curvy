/* Curvy: cubic Bézier mathematics and portable curve libraries. */
var CurvyCore = (function () {
    var C = {}, MAX_PRESETS = 1024, MAX_LIBRARIES = 64;
    C.version = '1.1.0';
    C.catalogVersion = '1.1.0';
    C.clamp = function (value, low, high) { return Math.max(low, Math.min(high, value)); };
    C.clone = function (value) { return JSON.parse(JSON.stringify(value)); };
    function array(value) { return Object.prototype.toString.call(value) === '[object Array]'; }
    function finite(value) { return typeof value === 'number' && isFinite(value); }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    C.validCurve = function (curve) {
        if (!array(curve) || curve.length !== 4) return false;
        for (var i = 0; i < 4; i++) if (!finite(curve[i])) return false;
        return curve[0] >= 0 && curve[0] <= 1 && curve[2] >= 0 && curve[2] <= 1 &&
            Math.abs(curve[1]) <= 20 && Math.abs(curve[3]) <= 20;
    };
    C.normalizeCurve = function (curve) {
        if (!C.validCurve(curve)) throw new Error('Enter four finite Bézier values. X must be 0–1; Y must be −20–20.');
        return curve.slice(0);
    };
    function coordinate(a, b, t) {
        var u = 1 - t;
        return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
    }
    C.point = function (curve, t) {
        C.normalizeCurve(curve);
        if (!finite(t)) throw new Error('Curve position must be a finite number.');
        t = C.clamp(t, 0, 1);
        return [coordinate(curve[0], curve[2], t), coordinate(curve[1], curve[3], t)];
    };
    C.evaluate = function (curve, x) {
        C.normalizeCurve(curve);
        if (!finite(x)) throw new Error('Time must be a finite number.');
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        // Bisection also handles zero derivatives and crossed X handles reliably.
        // Do not stop on X error: near a stationary derivative, small X errors can
        // still imply a large parameter (and hence Y) error.
        var lo = 0, hi = 1, t = x;
        for (var i = 0; i < 60; i++) {
            t = (lo + hi) / 2;
            var sampled = coordinate(curve[0], curve[2], t);
            if (sampled === x) return coordinate(curve[1], curve[3], t);
            if (sampled < x) lo = t;
            else hi = t;
        }
        return coordinate(curve[1], curve[3], (lo + hi) / 2);
    };
    C.reverse = function (curve) {
        curve = C.normalizeCurve(curve);
        var result = [1 - curve[2], 1 - curve[3], 1 - curve[0], 1 - curve[1]];
        return C.normalizeCurve(result);
    };
    C.mirror = function (curve, fromIncoming) {
        curve = C.normalizeCurve(curve);
        var result = fromIncoming ? [1 - curve[2], 1 - curve[3], curve[2], curve[3]] :
            [curve[0], curve[1], 1 - curve[0], 1 - curve[1]];
        return C.normalizeCurve(result);
    };
    C.curveEqual = function (a, b, tolerance) {
        if (!C.validCurve(a) || !C.validCurve(b)) return false;
        if (tolerance === undefined) tolerance = 0.000001;
        if (!finite(tolerance) || tolerance < 0) return false;
        for (var i = 0; i < 4; i++) if (Math.abs(a[i] - b[i]) > tolerance) return false;
        return true;
    };
    C.formatCurve = function (curve, css) {
        curve = C.normalizeCurve(curve);
        var values = [];
        for (var i = 0; i < 4; i++) values.push(String(Math.round(curve[i] * 1000000) / 1000000));
        return (css ? 'cubic-bezier(' : '') + values.join(', ') + (css ? ')' : '');
    };
    C.parseCurve = function (text) {
        if (typeof text !== 'string' || text.length > 512) throw new Error('Paste four Bézier values or a CSS cubic-bezier().');
        var body = text.replace(/^\s+|\s+$/g, '');
        if (/^cubic-bezier\s*\(/i.test(body)) {
            var css = /^cubic-bezier\s*\(([^()]*)\)\s*;?$/i.exec(body);
            if (!css) throw new Error('Invalid cubic-bezier() syntax.');
            body = css[1];
        } else if (body.charAt(0) === '[' && body.charAt(body.length - 1) === ']') body = body.slice(1, -1);
        var number = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
        var separator = '(?:\\s*,\\s*|\\s+)';
        var match = new RegExp('^\\s*(' + number + ')' + separator + '(' + number + ')' + separator + '(' + number + ')' + separator + '(' + number + ')\\s*$').exec(body);
        if (!match) throw new Error('Paste exactly four Bézier numbers, separated by commas or spaces.');
        return C.normalizeCurve([Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]);
    };
    function name(value, fallback) {
        if (value === undefined || value === null || value === '') return fallback;
        if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1F\x7F]/.test(value)) throw new Error('Library and preset names must be plain text, up to 120 characters.');
        value = value.replace(/^\s+|\s+$/g, '');
        return value || fallback;
    }
    function id(value, fallback) {
        if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value) || /^(?:__proto__|constructor|prototype)$/.test(value)) return fallback;
        return value;
    }
    C.validateLibrary = function (library, fallbackId) {
        if (!library || typeof library !== 'object' || array(library) || !array(library.presets)) throw new Error('This file is not a Curvy curve library.');
        if (library.presets.length > MAX_PRESETS) throw new Error('A library can contain up to ' + MAX_PRESETS + ' presets.');
        var result = {id: id(library.id, fallbackId || 'imported'), name: name(library.name, 'Imported'), presets: []}, ids = {};
        for (var i = 0; i < library.presets.length; i++) {
            var preset = library.presets[i];
            if (!preset || typeof preset !== 'object' || array(preset)) throw new Error('Preset ' + (i + 1) + ' is invalid.');
            var presetId = id(preset.id, 'preset-' + (i + 1));
            if (own(ids, presetId)) presetId = 'preset-' + (i + 1);
            while (own(ids, presetId)) presetId += '-copy';
            ids[presetId] = true;
            try { result.presets.push({id: presetId, name: name(preset.name, 'Curve ' + (i + 1)), curve: C.normalizeCurve(preset.curve)}); }
            catch (error) { throw new Error('Preset ' + (i + 1) + ': ' + error.message); }
        }
        return result;
    };
    C.validateLibraries = function (libraries) {
        if (!array(libraries) || libraries.length < 1 || libraries.length > MAX_LIBRARIES) throw new Error('Expected 1–' + MAX_LIBRARIES + ' curve libraries.');
        var result = [], ids = {};
        for (var i = 0; i < libraries.length; i++) {
            var library = C.validateLibrary(libraries[i], 'library-' + (i + 1));
            if (own(ids, library.id)) throw new Error('Duplicate library ID: ' + library.id);
            ids[library.id] = true;
            result.push(library);
        }
        return result;
    };
    C.parseLibrary = function (text, fallbackName) {
        if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('Choose a JSON curve library smaller than 2 MB.');
        var value;
        try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
        catch (error) { throw new Error('The library is not valid JSON.'); }
        if (value && value.format === 'curvy-library') {
            if (value.version !== 1) throw new Error('This Curvy library version is not supported.');
            value = value.library;
        }
        // A simple array of named Curvy presets is also accepted for hand-authored packs.
        if (array(value)) value = {name: 'Imported', presets: value};
        // Flow .flow files are JSON objects mapping names to four-value strings.
        // Verified against the public Google Material Design.flow preset pack.
        if (value && typeof value === 'object' && !array(value.presets)) {
            var presets = [], keys = Object.keys(value);
            if (keys.length > MAX_PRESETS) throw new Error('A library can contain up to ' + MAX_PRESETS + ' presets.');
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (typeof value[key] !== 'string') throw new Error('This file is not a Curvy or Flow curve library.');
                try { presets.push({id: 'preset-' + (i + 1), name: name(key, 'Curve ' + (i + 1)), curve: C.parseCurve(value[key])}); }
                catch (error) { throw new Error('Preset ' + (i + 1) + ': ' + error.message); }
            }
            value = {id: 'imported', name: name(fallbackName, 'Imported'), presets: presets};
        }
        return C.validateLibrary(value);
    };
    C.serializeLibrary = function (library, flowFormat) {
        library = C.validateLibrary(library);
        if (flowFormat) {
            var entries = [], names = [];
            for (var i = 0; i < library.presets.length; i++) {
                var preset = library.presets[i];
                if (names.indexOf(preset.name) >= 0) throw new Error('Flow export needs unique preset names. Rename duplicate presets first.');
                names.push(preset.name);
                // Construct from JSON-escaped strings so names like __proto__ are safe.
                entries.push('  ' + JSON.stringify(preset.name) + ': ' + JSON.stringify(C.formatCurve(preset.curve)));
            }
            return '{\n' + entries.join(',\n') + '\n}';
        }
        return JSON.stringify({format: 'curvy-library', version: 1, library: library}, null, 2);
    };
    C.defaultLibraries = function () {
        // Standard CSS curves and established cubic approximations to Penner families.
        // The first 25 entries follow the reference gallery's order. Preserve the
        // former one-third-influence Ease separately as AE Easy Ease.
        var entries = [
            ['linear', 'Linear', [0, 0, 1, 1]],
            ['ease-in', 'Ease In', [.42, 0, 1, 1]],
            ['ease-out', 'Ease Out', [0, 0, .58, 1]],
            ['ease-in-out', 'Ease', [.42, 0, .58, 1]],
            ['quad-in', 'Quad In', [.55, .085, .68, .53]],
            ['quad-out', 'Quad Out', [.25, .46, .45, .94]],
            ['quad-in-out', 'Quad', [.455, .03, .515, .955]],
            ['cubic-in', 'Cubic In', [.55, .055, .675, .19]],
            ['cubic-out', 'Cubic Out', [.215, .61, .355, 1]],
            ['cubic-in-out', 'Cubic', [.645, .045, .355, 1]],
            ['quart-in', 'Quart In', [.895, .03, .685, .22]],
            ['quart-out', 'Quart Out', [.165, .84, .44, 1]],
            ['quart-in-out', 'Quart', [.77, 0, .175, 1]],
            ['quint-in', 'Quint In', [.755, .05, .855, .06]],
            ['quint-out', 'Quint Out', [.23, 1, .32, 1]],
            ['quint-in-out', 'Quint', [.86, 0, .07, 1]],
            ['expo-in', 'Expo In', [.95, .05, .795, .035]],
            ['expo-out', 'Expo Out', [.19, 1, .22, 1]],
            ['expo-in-out', 'Expo', [1, 0, 0, 1]],
            ['circ-in', 'Circ In', [.6, .04, .98, .335]],
            ['circ-out', 'Circ Out', [.075, .82, .165, 1]],
            ['circ-in-out', 'Circ', [.785, .135, .15, .86]],
            ['back-in', 'Back In', [.6, -.28, .735, .045]],
            ['back-out', 'Back Out', [.175, .885, .32, 1.275]],
            ['back-in-out', 'Back', [.68, -.55, .265, 1.55]],
            ['ease', 'AE Easy Ease', [1/3, 0, 2/3, 1]],
            ['sine-in', 'Sine In', [.47, 0, .745, .715]],
            ['sine-out', 'Sine Out', [.39, .575, .565, 1]],
            ['sine-in-out', 'Sine In Out', [.445, .05, .55, .95]],
            ['css-ease', 'CSS Ease', [.25, .1, .25, 1]],
            ['css-ease-in', 'CSS Ease In', [.42, 0, 1, 1]],
            ['css-ease-out', 'CSS Ease Out', [0, 0, .58, 1]],
            ['css-ease-in-out', 'CSS Ease In Out', [.42, 0, .58, 1]],
            ['snappy', 'Snappy', [.8, 0, .2, 1]]
        ], presets = [];
        for (var i = 0; i < entries.length; i++) presets.push({id: entries[i][0], name: entries[i][1], curve: entries[i][2]});
        return [{id: 'built-in', name: 'Built-in', presets: presets}, {id: 'custom', name: 'Custom', presets: []}];
    };
    C.upgradeLibraries = function (libraries, catalogVersion) {
        var result=C.validateLibraries(libraries),builtin=null,defaults=C.defaultLibraries()[0].presets;
        if(catalogVersion===C.catalogVersion)return {libraries:result,changed:false};
        for(var i=0;i<result.length;i++)if(result[i].id==='built-in'){builtin=result[i];break;}
        // A deliberately deleted built-in library stays deleted.
        if(!builtin)return {libraries:result,changed:false};
        var byId={},addedIds=['ease-in','ease-out','ease-in-out'];
        for(i=0;i<defaults.length;i++)byId[defaults[i].id]=defaults[i];
        var legacyIds=['linear','ease','sine-in','sine-out','sine-in-out'];
        ['quad','cubic','quart','quint','expo','circ','back'].forEach(function(family){legacyIds.push(family+'-in',family+'-out',family+'-in-out');});
        legacyIds=legacyIds.concat(['css-ease','css-ease-in','css-ease-out','css-ease-in-out','snappy']);
        var pristine=builtin.presets.length===legacyIds.length;
        for(i=0;pristine&&i<legacyIds.length;i++){
            var expected=byId[legacyIds[i]],old=builtin.presets[i],oldName=expected.name;
            if(expected.id==='ease')oldName='Ease';
            else if(/^(quad|cubic|quart|quint|expo|circ|back)-in-out$/.test(expected.id))oldName+=' In Out';
            pristine=old.id===expected.id&&old.name===oldName&&C.curveEqual(old.curve,expected.curve,0);
        }
        if(pristine){builtin.presets=C.clone(defaults);return {libraries:result,changed:true};}
        var present={},names=[],missing=[],changed=false;
        for(i=0;i<builtin.presets.length;i++){
            var preset=builtin.presets[i];present[preset.id]=true;
            if(preset.id==='ease'&&preset.name==='Ease'&&C.curveEqual(preset.curve,[1/3,0,2/3,1],0)){preset.name='AE Easy Ease';changed=true;}
            names.push(preset.name);
        }
        for(i=0;i<addedIds.length;i++)if(!own(present,addedIds[i])){
            var addition=C.clone(byId[addedIds[i]]),base=addition.name;
            // Preserve a user-edited preset named Ease without introducing duplicate
            // names, which would prevent exporting that library in Flow format.
            for(var suffix=1;names.indexOf(addition.name)>=0;suffix++)addition.name=base+' (reference'+(suffix>1?' '+suffix:'')+')';
            names.push(addition.name);missing.push(addition);
        }
        if(builtin.presets.length+missing.length>MAX_PRESETS)throw new Error('The Built-in library is full. Free three preset slots to add the new easing presets.');
        if(missing.length){builtin.presets=missing.concat(builtin.presets);changed=true;}
        return {libraries:result,changed:changed};
    };
    return C;
})();
