// UniversalTryOn.js — ShoeAR "universal" AR try-on lens (FULL-AUTO prototype)
// =============================================================================
// ONE lens for ALL products. At launch it reads the product's model URL + fit
// transform from Camera Kit LaunchData, downloads the .glb AT RUNTIME, and
// places it on both feet (mirroring the single model for the other foot).
//
// If this works, there is NO per-shoe Lens Studio build: autofit.py computes the
// transform, the customer app passes { modelUrl, scale, pos, rot } as LaunchData,
// and this one lens renders any shoe. If it does NOT work (dynamic foot-binding,
// domain allowlist, or Draco fails), we fall back to the semi-automatic flow.
//
// SETUP (in Lens Studio 5.22, on a COPY of your Footwear Try-On project):
//   1. Add a Script asset with this file; attach it to a new SceneObject
//      "UniversalTryOn" at the top of the scene.
//   2. Add these to the project and drag them into the inputs below:
//        • RemoteMediaModule   (Asset Browser > + > RemoteMediaModule)
//        • RemoteServiceModule (Asset Browser > + > RemoteServiceModule)
//   3. Drag your template's "Left Foot Binding" and "Right Foot Binding"
//      SceneObjects into leftFoot / rightFoot.
//   4. DELETE or DISABLE the baked Shoe_L / Shoe_R meshes (model_L / model_R) —
//      this script supplies the shoe at runtime instead. KEEP the foot occluders.
//   5. Fill the fallback* values so you can test in the editor + on device
//      WITHOUT launch data first (use your known-good numbers from Shoe_L).
//   6. Allowlist your model host domain: Project settings > Extensions / API,
//      add the host of your .glb URLs (e.g. firebasestorage.googleapis.com or
//      your GCS bucket host). Remote downloads are blocked otherwise.
//
// TEST GOAL: shoe downloads from the URL and foot-tracks. If yes → full-auto is
// viable and we wire autofit.py + the app's LaunchData next.
// =============================================================================

// @input Asset.RemoteMediaModule remoteMediaModule
// @input Asset.RemoteServiceModule remoteServiceModule
// @input SceneObject leftFoot   {"label":"Left Foot Binding"}
// @input SceneObject rightFoot  {"label":"Right Foot Binding"}
// @input Asset.Material defaultMaterial {"label":"Fallback material (optional)"}
// @input string fallbackModelUrl {"label":"Fallback model URL (editor test)"}
// @input vec3 fallbackScale {"label":"Fallback scale"}
// @input vec3 fallbackPos   {"label":"Fallback position"}
// @input vec3 fallbackRot   {"label":"Fallback rotation (degrees)"}

// ---- read LaunchData (or fall back to the editor test values) ---------------
// Camera Kit LaunchData surfaces in the lens as global.launchParams
// (a GeneralDataStore). It's null in the editor, so we fall back.
function lpString(store, key, def) {
  return (store && store.has(key)) ? store.getString(key) : def;
}
function lpFloat(store, key, def) {
  return (store && store.has(key)) ? store.getFloat(key) : def;
}

var store = global.launchParams; // null when previewing without launch data

var modelUrl = lpString(store, 'modelUrl', script.fallbackModelUrl);
var scale = new vec3(
  lpFloat(store, 'sx', script.fallbackScale.x),
  lpFloat(store, 'sy', script.fallbackScale.y),
  lpFloat(store, 'sz', script.fallbackScale.z)
);
var pos = new vec3(
  lpFloat(store, 'px', script.fallbackPos.x),
  lpFloat(store, 'py', script.fallbackPos.y),
  lpFloat(store, 'pz', script.fallbackPos.z)
);
var rot = new vec3(
  lpFloat(store, 'rx', script.fallbackRot.x),
  lpFloat(store, 'ry', script.fallbackRot.y),
  lpFloat(store, 'rz', script.fallbackRot.z)
);

// ---- download the model at runtime, then place it on both feet --------------
if (!modelUrl) {
  print('ShoeAR: no modelUrl (set fallbackModelUrl or pass LaunchData).');
} else {
  print('ShoeAR: downloading model → ' + modelUrl);
  var resource = script.remoteServiceModule.makeResourceFromUrl(modelUrl);
  script.remoteMediaModule.loadResourceAsGltfAsset(resource, onLoaded, onError);
}

function onLoaded(gltfAsset) {
  print('ShoeAR: model downloaded, instantiating on both feet.');
  placeOnFoot(gltfAsset, script.rightFoot, false); // model as-authored = right foot
  placeOnFoot(gltfAsset, script.leftFoot, true);   // mirror for the left foot
}

function onError() {
  print('ShoeAR: FAILED to download/parse model: ' + modelUrl +
        ' (check domain allowlist + that the .glb is public and not Draco-only).');
}

// Instantiate the downloaded glTF under a foot binding and apply the transform.
// mirror=true reflects across X so a single (right) shoe becomes the left one.
function placeOnFoot(gltfAsset, footBinding, mirror) {
  if (!footBinding) { print('ShoeAR: missing foot binding input.'); return; }

  var settings = GltfSettings.create();
  settings.convertMetersToCentimeters = true; // glTF is metres; Lens Studio is cm

  // Preferred API (with settings). If your LS build lacks it, use the fallback
  // line below: gltfAsset.tryInstantiate(footBinding, script.defaultMaterial)
  var obj = gltfAsset.tryInstantiateWithConfiguration(
    footBinding, script.defaultMaterial, settings
  );
  if (!obj) { print('ShoeAR: instantiate failed on ' + footBinding.name); return; }

  var t = obj.getTransform();
  var s = mirror ? new vec3(-scale.x, scale.y, scale.z) : scale;
  var p = mirror ? new vec3(-pos.x, pos.y, pos.z) : pos;
  var deg = Math.PI / 180.0;
  t.setLocalPosition(p);
  t.setLocalRotation(quat.fromEulerAngles(rot.x * deg, rot.y * deg, rot.z * deg));
  t.setLocalScale(s);
}
