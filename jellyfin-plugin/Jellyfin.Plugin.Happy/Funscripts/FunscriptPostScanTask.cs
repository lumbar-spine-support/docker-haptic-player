using System;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Happy.Funscripts;

/// <summary>
/// Rebuilds the funscript index after each library scan.
/// </summary>
public class FunscriptPostScanTask : ILibraryPostScanTask
{
    private readonly FunscriptIndex _index;

    /// <summary>
    /// Initializes a new instance of the <see cref="FunscriptPostScanTask"/> class.
    /// </summary>
    /// <param name="index">The funscript index.</param>
    public FunscriptPostScanTask(FunscriptIndex index)
    {
        _index = index;
    }

    /// <inheritdoc />
    public Task Run(IProgress<double> progress, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(progress);
        _index.Rebuild();
        progress.Report(100);
        return Task.CompletedTask;
    }
}
