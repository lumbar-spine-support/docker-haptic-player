using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// Documentation pages returned by <c>GET /Happy/Docs</c>.
/// </summary>
/// <param name="Pages">Page names without extension.</param>
public sealed record DocsIndex([property: JsonPropertyName("pages")] IReadOnlyList<string> Pages);
