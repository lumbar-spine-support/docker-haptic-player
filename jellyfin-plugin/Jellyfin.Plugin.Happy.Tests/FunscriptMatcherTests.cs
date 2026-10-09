using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.Happy.Funscripts;
using Xunit;

namespace Jellyfin.Plugin.Happy.Tests;

public class FunscriptMatcherTests
{
    private static readonly Guid Video = Guid.NewGuid();
    private static readonly Guid Audio = Guid.NewGuid();
    private static readonly Guid Elsewhere = Guid.NewGuid();

    private static Dictionary<Guid, List<string>> Match(IEnumerable<MediaFile> media, params string[] scripts)
        => FunscriptMatcher.Match(media, scripts, ".")
            .ToDictionary(e => e.Key, e => e.Value.Select(f => f.FileName).ToList());

    [Fact]
    public void MatchesUntypedTypedAndSubcategoryScriptsInTheSameDirectory()
    {
        var result = Match(
            [new MediaFile(Video, "/lib/v/Clip One.mp4")],
            "/lib/v/Clip One.funscript",
            "/lib/v/clip one.stroker.funscript",
            "/lib/v/Clip One.estim.Nipples.funscript");

        Assert.Equal(["Clip One.estim.Nipples.funscript", "Clip One.funscript", "clip one.stroker.funscript"], result[Video]);
    }

    [Fact]
    public void PrefersTheLongestStem()
    {
        var shortStem = Guid.NewGuid();
        var result = Match(
            [new MediaFile(shortStem, "/lib/a.mp4"), new MediaFile(Video, "/lib/a.b.mp4")],
            "/lib/a.b.stroker.funscript",
            "/lib/a.vibrator.funscript");

        Assert.Equal(["a.b.stroker.funscript"], result[Video]);
        Assert.Equal(["a.vibrator.funscript"], result[shortStem]);
    }

    [Fact]
    public void SameDirectoryWinsOverLibraryWideMatches()
    {
        var result = Match(
            [new MediaFile(Video, "/lib/v/song.mp4"), new MediaFile(Audio, "/lib/a/song.mp3")],
            "/lib/a/song.funscript");

        Assert.Equal(["song.funscript"], result[Audio]);
        Assert.False(result.ContainsKey(Video));
    }

    [Fact]
    public void FallsBackToEveryMediaWithTheStemAnywhere()
    {
        var result = Match(
            [new MediaFile(Video, "/lib/v/song.mp4"), new MediaFile(Audio, "/lib/a/song.mp3"), new MediaFile(Elsewhere, "/lib/x/other.mp4")],
            "/lib/scripts/song.stroker.funscript");

        Assert.Equal(["song.stroker.funscript"], result[Video]);
        Assert.Equal(["song.stroker.funscript"], result[Audio]);
        Assert.False(result.ContainsKey(Elsewhere));
    }

    [Fact]
    public void IgnoresUnmatchedAndNonFunscriptFiles()
    {
        var result = Match(
            [new MediaFile(Video, "/lib/v/clip.mp4")],
            "/lib/v/unrelated.funscript",
            "/lib/v/clip.json",
            "/lib/v/.funscript");

        Assert.Empty(result);
    }

    [Fact]
    public void HonoursACustomSeparator()
    {
        var result = FunscriptMatcher.Match([new MediaFile(Video, "/lib/clip.mp4")], ["/lib/clip_stroker.funscript"], "_");

        Assert.Equal("clip_stroker.funscript", Assert.Single(result[Video]).FileName);
    }

    [Fact]
    public void KeysAreStableShortAndPathSpecific()
    {
        Assert.Equal(FunscriptMatcher.KeyFor("/lib/a.funscript"), FunscriptMatcher.KeyFor("/lib/a.funscript"));
        Assert.NotEqual(FunscriptMatcher.KeyFor("/lib/a.funscript"), FunscriptMatcher.KeyFor("/lib2/a.funscript"));
        Assert.Matches("^[0-9a-f]{16}$", FunscriptMatcher.KeyFor("/lib/a.funscript"));
    }

    [Fact]
    public void CandidateStemsAreLongestFirstAndNeverEmpty()
    {
        Assert.Equal(["a.b.c", "a.b", "a"], FunscriptMatcher.CandidateStems("a.b.c", "."));
        Assert.Equal([".hidden"], FunscriptMatcher.CandidateStems(".hidden", "."));
    }
}
