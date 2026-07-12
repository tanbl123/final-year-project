// ShoeModelLoader.cs — loads a .glb/.gltf shoe model at runtime from a URL
// (your Firebase Storage links) using the glTFast package.
//
// Install glTFast in Unity: Package Manager → Add package by name →
//   com.unity.cloud.gltfast     (older projects: com.atteneder.gltfast)
//
// If a network model fails to load (offline demo, bad URL), assign a bundled
// fallback prefab in the Inspector so the try-on still shows something.

using System.Threading.Tasks;
using UnityEngine;
using GLTFast;

public class ShoeModelLoader : MonoBehaviour
{
    [Tooltip("Optional: shown when the remote .glb cannot be loaded.")]
    [SerializeField] private GameObject fallbackPrefab;

    /// Loads the model at `url` and returns its root GameObject (null on failure
    /// with no fallback). The caller owns/positions/destroys the returned object.
    public async Task<GameObject> Load(string url)
    {
        if (!string.IsNullOrEmpty(url))
        {
            var root = new GameObject("Shoe");
            var gltf = new GltfImport();
            var loaded = await gltf.Load(url);
            if (loaded)
            {
                await gltf.InstantiateMainSceneAsync(root.transform);
                return root;
            }
            Destroy(root); // load failed → fall through to the fallback
        }

        if (fallbackPrefab != null)
        {
            return Instantiate(fallbackPrefab);
        }
        return null;
    }
}
