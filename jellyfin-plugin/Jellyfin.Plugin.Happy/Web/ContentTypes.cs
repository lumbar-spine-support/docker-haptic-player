using Microsoft.AspNetCore.StaticFiles;

namespace Jellyfin.Plugin.Happy.Web;

/// <summary>
/// Content types of the files the plugin serves.
/// </summary>
internal static class ContentTypes
{
    private static readonly FileExtensionContentTypeProvider Provider = CreateProvider();

    /// <summary>
    /// Gets the content type of a file name, or <c>application/octet-stream</c>.
    /// </summary>
    /// <param name="fileName">File name or path.</param>
    /// <returns>The content type.</returns>
    public static string Of(string fileName)
        => Provider.TryGetContentType(fileName, out var type) ? type : "application/octet-stream";

    private static FileExtensionContentTypeProvider CreateProvider()
    {
        var provider = new FileExtensionContentTypeProvider();
        provider.Mappings[".md"] = "text/markdown; charset=utf-8";
        provider.Mappings[".webmanifest"] = "application/manifest+json";
        provider.Mappings[".js"] = "text/javascript; charset=utf-8";
        provider.Mappings[".css"] = "text/css; charset=utf-8";
        provider.Mappings[".html"] = "text/html; charset=utf-8";
        return provider;
    }
}
