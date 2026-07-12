// ArTryOnController.cs — the AR try-on brain, attached to a GameObject named
// "ARController" in the Unity scene (the name Flutter addresses messages to).
//
// Responsibilities:
//   • receive commands from Flutter (SetModel / SetScale / Rotate / Flip / Reset / Capture)
//   • tap-to-place the shoe on an AR-Foundation-detected plane (ARRaycastManager)
//   • apply the geometric transform (scale, rotation, flip) — Chapter 4 algorithm
//   • take a screenshot ("Capture") and report events back to Flutter
//
// NOTE ON PARAMETERS (your tuning work): the fields in the "Tunable parameters"
// region below are what YOU calibrate per the report's algorithm — e.g.
//   ScaleFactor = DetectedFootWidth / ModelWidth  →  baseScale
// AR Foundation supplies the SLAM tracking/rendering; changing these values so
// the shoe sits/looks correct is the student contribution.

using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using FlutterUnityIntegration; // provided by flutter_unity_widget's Unity export

public class ArTryOnController : MonoBehaviour
{
    [Header("AR Foundation references (assign in the Inspector)")]
    [SerializeField] private ARRaycastManager raycastManager;
    [SerializeField] private ShoeModelLoader modelLoader;

    // ── Tunable parameters (YOUR calibration work) ───────────────────────────
    [Header("Tunable parameters")]
    [Tooltip("Base scale applied to every model = ScaleFactor (DetectedFootWidth / ModelWidth). Calibrate so a size-UK9 shoe looks life-sized.")]
    [SerializeField] private float baseScale = 1.0f;
    [Tooltip("Degrees added per Rotate tap.")]
    [SerializeField] private float rotationStep = 15f;
    [Tooltip("Where the shoe floats before the user taps a surface (metres, camera space).")]
    [SerializeField] private Vector3 previewOffset = new Vector3(0f, -0.3f, 1.2f);

    // ── runtime state ────────────────────────────────────────────────────────
    private GameObject _shoe;      // the loaded shoe instance
    private float _userScale = 1f; // slider value from Flutter
    private float _rotationY = 0f;
    private bool _flipped = false;
    private bool _placed = false;

    private static readonly List<ARRaycastHit> _hits = new List<ARRaycastHit>();

    // ── tap-to-place onto a detected plane ────────────────────────────────────
    private void Update()
    {
        if (_shoe == null || Input.touchCount == 0) return;
        var touch = Input.GetTouch(0);
        if (touch.phase != TouchPhase.Began) return;

        if (raycastManager != null &&
            raycastManager.Raycast(touch.position, _hits, TrackableType.PlaneWithinPolygon))
        {
            _shoe.transform.position = _hits[0].pose.position;
            if (!_placed)
            {
                _placed = true;
                SendEvent("placed", "");
            }
            ApplyTransform();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Commands from Flutter (postMessage("ARController", <method>, <payload>))
    //  Each Unity message handler must be:  public void Name(string message)
    // ══════════════════════════════════════════════════════════════════════════

    public async void SetModel(string url)
    {
        if (_shoe != null) Destroy(_shoe);
        _placed = false;
        _shoe = await modelLoader.Load(url);
        if (_shoe == null)
        {
            SendEvent("error", "load_failed");
            return;
        }
        // float in front of the camera until the user taps a surface
        _shoe.transform.SetParent(Camera.main != null ? Camera.main.transform : null, false);
        _shoe.transform.localPosition = previewOffset;
        _shoe.transform.SetParent(null, true);
        ResetTransform();
        SendEvent("ready", "");
    }

    public void SetScale(string value)
    {
        if (float.TryParse(value, out var v)) _userScale = v;
        ApplyTransform();
    }

    public void Rotate(string degrees)
    {
        // Flutter sends "15" or "-15"; ignore its magnitude and use our step so
        // the increment stays a single tuned parameter.
        var dir = degrees.StartsWith("-") ? -1f : 1f;
        _rotationY += dir * rotationStep;
        ApplyTransform();
    }

    public void Flip(string _)
    {
        _flipped = !_flipped;
        ApplyTransform();
    }

    public void Reset(string _)
    {
        ResetTransform();
    }

    public void Capture(string _)
    {
        StartCoroutine(CaptureRoutine());
    }

    // ── transform + helpers ────────────────────────────────────────────────────
    private void ResetTransform()
    {
        _userScale = 1f;
        _rotationY = 0f;
        _flipped = false;
        ApplyTransform();
    }

    private void ApplyTransform()
    {
        if (_shoe == null) return;
        var s = baseScale * _userScale;                 // final ScaleFactor
        var sx = _flipped ? -s : s;                     // horizontal reflection = Flip
        _shoe.transform.localScale = new Vector3(sx, s, s);
        _shoe.transform.rotation = Quaternion.Euler(0f, _rotationY, 0f);
    }

    private IEnumerator CaptureRoutine()
    {
        yield return new WaitForEndOfFrame();
        var tex = ScreenCapture.CaptureScreenshotAsTexture();
        var png = tex.EncodeToPNG();
        Destroy(tex);
        var path = System.IO.Path.Combine(
            Application.persistentDataPath,
            "ar_tryon_" + System.DateTime.Now.Ticks + ".png");
        System.IO.File.WriteAllBytes(path, png);
        SendEvent("captured", path);
    }

    private void SendEvent(string type, string data)
    {
        // minimal JSON — the Flutter side parses {type, data}
        var safe = (data ?? "").Replace("\\", "/").Replace("\"", "'");
        var json = "{\"type\":\"" + type + "\",\"data\":\"" + safe + "\"}";
        UnityMessageManager.Instance.SendMessageToFlutter(json);
    }
}
