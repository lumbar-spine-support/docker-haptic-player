using System;
using Jellyfin.Plugin.Happy.Api;
using Xunit;

namespace Jellyfin.Plugin.Happy.Tests;

public class HappyInfoTests
{
    [Theory]
    [InlineData("1.1.0.0", false, "stable")]
    [InlineData("1.1.0", false, "stable")]
    [InlineData("1.1.0.37", false, "beta")]
    [InlineData("1.1.0.37", true, "dev")]
    [InlineData("1.1.0.0", true, "dev")]
    public void TellsTheChannelFromTheVersion(string version, bool debug, string channel)
        => Assert.Equal(channel, HappyInfo.ChannelOf(Version.Parse(version), debug));

    [Fact]
    public void TreatsAMissingVersionAsStable()
        => Assert.Equal("stable", HappyInfo.ChannelOf(null, debug: false));
}
