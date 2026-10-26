/* Curvy: EffectCraft keyframe bridge. All timeline edits use native undoable commands. */
var CurvyHost = (function () {
    var H = {}, EPS = 1e-8, MARK = '// Curvy v1 ';
    function fail(s) { throw new Error(s); }
    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function finite(n) { return typeof n === 'number' && isFinite(n); }
    function valid(c) { return c instanceof Array && c.length === 4 && c.every(finite) && c[0] >= 0 && c[0] <= 1 && c[2] >= 0 && c[2] <= 1 && Math.abs(c[1])<=20 && Math.abs(c[3])<=20; }
    function direction(v) { v = v || 'both'; if (['both', 'in', 'out'].indexOf(v) < 0) fail('Choose incoming, outgoing, or both sides.'); return v; }
    function unique(a, s) { if (a.indexOf(s) < 0) a.push(s); }
    function reverse(c) { return [1-c[2],1-c[3],1-c[0],1-c[1]]; }
    function trackDirection(t,dir) { return t.layer.stretch<0?(dir==='in'?'out':dir==='out'?'in':'both'):dir; }
    function ref(t, k) { return { comp:t.comp.id, __keys:[{layer:t.layer.id,prop:t.prop.__uid,index:k}] }; }
    function propRef(t) { return {comp:t.comp.id,layer:t.layer.id,prop:t.prop.__uid}; }
    function step(list, command, p, extra) { for (var k in extra) if (extra.hasOwnProperty(k)) p[k]=extra[k]; list.push({command:command,params:p}); }
    function batch(steps, label) {
        if (!steps.length) return;
        var before = app.project.__info().revision, name = 'Curvy · ' + label, error = null;
        app.beginUndoGroup(name);
        try { for (var i=0;i<steps.length;i++) app.run(steps[i].command, steps[i].params); }
        catch (e) { error=e; }
        finally { app.endUndoGroup(); }
        if (error) {
            var undo=app.run('project.summary',{}).undo||[];
            if (app.project.__info().revision!==before && undo[undo.length-1]===name) app.run('edit.undo',{});
            throw error;
        }
    }
    H.capture = function () {
        var comp=app.project.activeItem, tracks=[];
        if (!(comp instanceof CompItem)) fail('Open a composition and select two adjacent keyframes.');
        var props=comp.selectedProperties;
        for (var i=0;i<props.length;i++) {
            var p=props[i]; if (p.propertyType!==PropertyType.PROPERTY || !p.numKeys) continue;
            var keys=p.selectedKeys; if (!keys.length) continue;
            if (!p.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER)) fail(p.name+' cannot use Bezier easing.');
            var pairs=[]; keys.sort(function(a,b){return a-b;});
            for (var j=1;j<keys.length;j++) if (keys[j]===keys[j-1]+1) pairs.push(keys[j-1]-1);
            if (!pairs.length) fail('Select at least two adjacent keys on '+p.name+'. Gaps are left untouched.');
            tracks.push({comp:comp,layer:p.propertyGroup(p.propertyDepth),prop:p,keys:keys,raw:p.__keys(),pairs:pairs});
        }
        if (!tracks.length) fail('Select two adjacent timeline keyframes.');
        return tracks;
    };
    H.selectionInfo = function () {
        try { var ts=H.capture(), n=0, s=0; for(var i=0;i<ts.length;i++){n+=ts[i].keys.length;s+=ts[i].pairs.length;}
            return {valid:true,keys:n,segments:s,properties:ts.length,label:ts[0].layer.name+' / '+ts[0].prop.name};
        } catch(e) { return {valid:false,keys:0,segments:0,properties:0,label:e.message}; }
    };
    function preflight(t, expression) {
        if(t.layer.locked) fail('Unlock '+t.layer.name+' before easing its keys.');
        for(var i=0;i<t.keys.length;i++) if(t.raw[t.keys[i]-1].roving) fail('Turn off Roving on the selected keys before applying a curve.');
        if(t.prop.expressionEnabled && !expression) fail('Disable the expression on '+t.prop.name+' before applying keyframe easing.');
        if(expression && t.prop.expression && t.prop.expression.indexOf(MARK)!==0) fail(t.prop.name+' already has an expression. Curvy will not replace it.');
    }
    // Match EffectCraft's spatial speed units: integrated path length / layer-time duration.
    function pathLength(a,b) {
        var nodes=[0,-.5384693101056831,.5384693101056831,-.906179845938664,.906179845938664], weights=[.5688888888888889,.4786286704993665,.4786286704993665,.2369268850561891,.2369268850561891], total=0;
        for(var i=0;i<96;i++) for(var j=0;j<5;j++) {
            var q=(i+.5)/96+nodes[j]/192,u=1-q,sum=0;
            for(var d=0;d<a.value.length;d++) { var p0=a.value[d],p1=p0+(a.spatialOut[d]||0),p3=b.value[d],p2=p3+(b.spatialIn[d]||0),v=3*u*u*(p1-p0)+6*u*q*(p2-p1)+3*q*q*(p3-p2);sum+=v*v; }
            total+=weights[j]*Math.sqrt(sum)/192;
        }
        return total;
    }
    function slopes(t,k) {
        var a=t.raw[k],b=t.raw[k+1],dt=b.layerTime-a.layerTime,n=a.outEase.length,s=[];
        if(!(dt>EPS)) fail('The selected segment has no duration.');
        if(t.prop.isSpatial) {var len=pathLength(a,b);for(var d=0;d<n;d++)s.push(len/dt);}
        else if(typeof a.value==='number') s.push((b.value-a.value)/dt);
        else if(a.value instanceof Array) for(var j=0;j<n;j++)s.push(((b.value[j]||0)-(a.value[j]||0))/dt);
        else for(var f=0;f<n;f++)s.push(1/dt);
        return s;
    }
    function expressionData(p) {
        var text=p.expression||'';if(text.indexOf(MARK)!==0)return null;
        try {var d=JSON.parse(text.slice(MARK.length,text.indexOf('\n')));return d&&d.version===1&&d.curves instanceof Array?d:null;}catch(e){return null;}
    }
    function nativeCurves(t,k) {
        var a=t.raw[k],b=t.raw[k+1],ss=slopes(t,k),out=[];
        if(a.outInterp==='HOLD') fail('Hold interpolation has no cubic curve. Choose Linear or Easy Ease first.');
        for(var d=0;d<ss.length;d++) {
            var oe=a.outEase[d]||a.outEase[0],ie=b.inEase[d]||b.inEase[0],x1=a.outInterp==='LINEAR'?1/3:oe.influence/100,x2=b.inInterp!=='BEZIER'?2/3:1-ie.influence/100;
            var os=a.outInterp==='LINEAR'?ss[d]:oe.speed,ins=b.inInterp!=='BEZIER'?ss[d]:ie.speed;
            if(Math.abs(ss[d])<EPS) {if(Math.abs(os)>EPS||Math.abs(ins)>EPS) fail('Cannot normalize a moving curve between equal endpoint values.');out.push([x1,0,x2,1]);}
            else out.push([x1,os/ss[d]*x1,x2,1-ins/ss[d]*(1-x2)]);
        }
        return out;
    }
    function curvesAt(t,k) {
        var data=expressionData(t.prop);
        if(t.prop.expressionEnabled && data && data.count!==t.raw.length) fail('The number of keys changed. Reapply the expression before reading its curve.');
        if(t.prop.expressionEnabled && data && data.count===t.raw.length && data.curves[k]) return clone(data.curves[k]);
        if(t.prop.expressionEnabled && !data) fail('Read Values cannot extract a curve from another expression.');
        return nativeCurves(t,k);
    }
    H.read = function (options) {
        options=options||{};
        var ts=H.capture(),t=ts[0],k=t.pairs[t.layer.stretch<0?t.pairs.length-1:0];
        if(options.mode==='expression'&&(!t.prop.expressionEnabled||!expressionData(t.prop)))fail('Select keys driven by a Curvy expression to read expression values.');
        var cs=options.mode==='keys'?nativeCurves(t,k):curvesAt(t,k),ss=slopes(t,k),dim=0,warnings=[];
        for(var d=1;d<ss.length;d++)if(Math.abs(ss[d])>Math.abs(ss[dim]))dim=d;
        var c=cs[dim]||cs[0];
        for(d=0;d<cs.length;d++)if(Math.abs(ss[d])>EPS&&cs[d].some(function(v,n){return Math.abs(v-c[n])>EPS;})){warnings.push('Read the dominant changing dimension; this property has different curves per dimension.');break;}
        if(ts.length>1||t.pairs.length>1)warnings.push('Read the first selected segment.');
        return {curve:t.layer.stretch<0?reverse(c):c,property:t.prop.name,properties:ts.length,segments:t.pairs.length,warnings:warnings};
    };
    function merged(c,prior,dir) { return dir==='in'?[prior[0],prior[1],c[2],c[3]]:dir==='out'?[c[0],c[1],prior[2],prior[3]]:c.slice(); }
    function curvedPath(t,k) {
        var a=t.raw[k],b=t.raw[k+1],len2=0;for(var d=0;d<a.value.length;d++)len2+=(b.value[d]-a.value[d])*(b.value[d]-a.value[d]);
        function onLine(tan) {var dot=0,norm=0;for(var i=0;i<a.value.length;i++){dot+=(tan[i]||0)*(b.value[i]-a.value[i]);norm+=(tan[i]||0)*(tan[i]||0);}return len2>EPS?norm-dot*dot/len2<1e-8:norm<EPS;}
        return !onLine(a.spatialOut)||!onLine(b.spatialIn);
    }
    function outside(c) {
        // y extrema, independent of x; catches true overshoot without rejecting harmless handles.
        var a=3*c[1]-3*c[3]+1,b=2*(c[3]-2*c[1]),cc=c[1],roots=[];
        if(Math.abs(a)<EPS){if(Math.abs(b)>EPS)roots.push(-cc/b);}else {var disc=b*b-4*a*cc;if(disc>=0){roots.push((-b+Math.sqrt(disc))/(2*a));roots.push((-b-Math.sqrt(disc))/(2*a));}}
        for(var i=0;i<roots.length;i++){var q=roots[i];if(q>0&&q<1){var u=1-q,y=3*u*u*q*c[1]+3*u*q*q*c[3]+q*q*q;if(y< -EPS||y>1+EPS)return true;}}
        return false;
    }
    function writeKeys(t,c,dir,steps,warnings,interpolation) {
        var changes={},count=0;
        function change(k){if(!changes[k]){var a=t.raw[k];changes[k]={inc:clone(a.inEase),out:clone(a.outEase),inType:a.inInterp,outType:a.outInterp};count++;}return changes[k];}
        for(var i=0;i<t.pairs.length;i++) {
            var k=t.pairs[i],ss=slopes(t,k),a,b;
            if(!interpolation && t.prop.isSpatial && curvedPath(t,k)) {
                var actual=c;
                if(dir!=='both' && t.raw[k].outInterp!=='HOLD') actual=merged(c,nativeCurves(t,k)[0],dir);
                if(!(dir==='in'&&t.raw[k].outInterp==='HOLD')&&outside(actual))fail('Curved Position paths cannot overshoot their endpoints. Separate Position dimensions for overshoot.');
            }
            if(dir!=='in') {
                a=change(k);a.outType=interpolation||'BEZIER';
                if(!interpolation)for(var d=0;d<a.out.length;d++)a.out[d]={influence:Math.max(.001,c[0])*100,speed:c[1]/Math.max(.001,c[0])*(ss[d]||0)};
            }
            if(dir!=='out') {
                b=change(k+1);b.inType=interpolation||'BEZIER';
                if(!interpolation)for(var e=0;e<b.inc.length;e++)b.inc[e]={influence:Math.max(.001,1-c[2])*100,speed:(1-c[3])/Math.max(.001,1-c[2])*(ss[e]||0)};
            }
        }
        for(var index in changes)if(changes.hasOwnProperty(index)) {
            var ch=changes[index];
            // Supplying both *effective* ease arrays preserves the other side of automatic/spatial keys.
            step(steps,'keys.velocity',ref(t,Number(index)),{inSpeed:ch.inc.map(function(v){return v.speed;}),inInfluence:ch.inc.map(function(v){return v.influence;}),outSpeed:ch.out.map(function(v){return v.speed;}),outInfluence:ch.out.map(function(v){return v.influence;})});
            step(steps,'keys.interpolation',ref(t,Number(index)),{'in':ch.inType,out:ch.outType,autoBezier:false,continuous:false});
        }
        return count;
    }
    function makeExpression(data) {
        return MARK+JSON.stringify(data)+'\n'+
            '(function(){\nvar data='+JSON.stringify(data)+';\n'+
            'if(numKeys!==data.count || numKeys<2) return value;\n'+
            'var n=nearestKey(time).index;if(key(1).time<key(numKeys).time){if(key(n).time>time)n--;}else{if(key(n).time<time)n--;}\n'+
            'if(n<1||n>=numKeys||!data.curves[n-1])return value;\n'+
            'var a=key(n),b=key(n+1),x=(time-a.time)/(b.time-a.time);if(x<0||x>1)return value;\n'+
            'function ease(c){var lo=0,hi=1,q=.5;for(var j=0;j<48;j++){q=(lo+hi)/2;var u=1-q,v=3*u*u*q*c[0]+3*u*q*q*c[2]+q*q*q;if(v<x)lo=q;else hi=q;}var u=1-q;return 3*u*u*q*c[1]+3*u*q*q*c[3]+q*q*q;}\n'+
            'var curves=data.curves[n-1];if(typeof a.value==="number")return a.value+(b.value-a.value)*ease(curves[0]);\n'+
            'var result=[];for(var d=0;d<a.value.length;d++)result[d]=a.value[d]+(b.value[d]-a.value[d])*ease(curves[d]||curves[0]);return result;\n'+
            '})()';
    }
    H.apply = function (c, options) {
        if(!valid(c))fail('Use four finite Bezier coordinates: X between 0 and 1, Y between -20 and 20.');
        options=options||{};var dir=direction(options.direction),mode=options.mode||'keys',ts=H.capture(),steps=[],count=0,segments=0,warnings=[];
        if(mode!=='keys'&&mode!=='expression')fail('Unknown curve application mode.');
        if(mode==='keys'&&((dir!=='in'&&c[0]<.001)||(dir!=='out'&&c[2]>.999)))warnings.push('Endpoint X was limited to 0.1% influence. Expression mode preserves the exact curve.');
        for(var i=0;i<ts.length;i++) {
            var t=ts[i],tc=t.layer.stretch<0?reverse(c):c,td=trackDirection(t,dir);preflight(t,mode==='expression');segments+=t.pairs.length;
            if(mode==='keys') count+=writeKeys(t,tc,td,steps,warnings,null);
            else {
                if(!t.prop.canSetExpression)fail(t.prop.name+' does not support expressions.');
                if(t.prop.isSpatial)fail('Separate Position dimensions before applying an expression. Keyframe mode preserves the motion path.');
                if(typeof t.raw[0].value!=='number'&&!(t.raw[0].value instanceof Array))fail('Expression curves support numeric properties only.');
                var data=expressionData(t.prop);if(!data||data.count!==t.raw.length)data={version:1,count:t.raw.length,curves:[]};
                for(var j=0;j<t.pairs.length;j++) {
                    var k=t.pairs[j],dim=typeof t.raw[k].value==='number'?1:t.raw[k].value.length,prior=td==='both'?null:curvesAt(t,k),cs=[];
                    for(var d=0;d<dim;d++)cs.push(merged(tc,prior?(prior[d]||prior[0]):tc,td));data.curves[k]=cs;
                }
                step(steps,'prop.setExpression',propRef(t),{expression:makeExpression(data),enabled:true});count+=t.keys.length;
                unique(warnings,'Expression intervals follow moved keys. Reapply after inserting or deleting keys.');
            }
        }
        batch(steps,mode==='expression'?'Apply expression':'Apply curve');
        return {changed:count,segments:segments,properties:ts.length,mode:mode,warnings:warnings};
    };
    H.interpolate = function (mode, dir) {
        dir=direction(dir);if(mode==='ease')return H.apply([1/3,0,2/3,1],{direction:dir});
        if(mode!=='linear'&&mode!=='hold')fail('Unknown interpolation.');
        var ts=H.capture(),steps=[],count=0,segments=0;
        for(var i=0;i<ts.length;i++){preflight(ts[i],false);count+=writeKeys(ts[i],null,trackDirection(ts[i],dir),steps,[],mode.toUpperCase());segments+=ts[i].pairs.length;}
        batch(steps,mode==='linear'?'Linear keys':'Hold keys');return {changed:count,segments:segments,properties:ts.length,mode:'keys',warnings:[]};
    };
    return H;
})();
