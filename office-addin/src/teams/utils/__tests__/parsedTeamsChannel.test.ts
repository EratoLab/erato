import { describe, expect, it } from "vitest";

import {
  isRestrictedChannel,
  parseTeamChannels,
  sortTeamsChannels,
} from "../parsedTeamsChannel";

const team = { id: "team-1", displayName: "Erato Labs" };

describe("parseTeamChannels", () => {
  it("flattens a team's channels onto the team name", () => {
    const parsed = parseTeamChannels(team, [
      { id: "c1", displayName: "General" },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      teamId: "team-1",
      channelId: "c1",
      name: "General",
      teamName: "Erato Labs",
      membershipType: "standard",
      ref: { kind: "channel", teamId: "team-1", channelId: "c1" },
    });
  });

  it("drops archived channels, which can never take a new message", () => {
    const parsed = parseTeamChannels(team, [
      { id: "c1", displayName: "Live" },
      { id: "c2", displayName: "Old", isArchived: true },
    ]);

    expect(parsed.map((channel) => channel.name)).toEqual(["Live"]);
  });

  it("skips a channel with no id and a team with no id", () => {
    expect(parseTeamChannels(team, [{ displayName: "Nameless" }])).toEqual([]);
    expect(parseTeamChannels({ displayName: "No id" }, [{ id: "c1" }])).toEqual(
      [],
    );
  });

  it("treats post layout as threaded and chat layout as flat", () => {
    const [post, chat] = parseTeamChannels(team, [
      { id: "c1", layoutType: "post" },
      { id: "c2", layoutType: "chat" },
    ]);

    expect(post?.isThreaded).toBe(true);
    expect(chat?.isThreaded).toBe(false);
  });
});

describe("isRestrictedChannel", () => {
  it("flags private and shared channels, not standard ones", () => {
    const [standard, priv, shared] = parseTeamChannels(team, [
      { id: "c1", membershipType: "standard" },
      { id: "c2", membershipType: "private" },
      { id: "c3", membershipType: "shared" },
    ]);

    expect(isRestrictedChannel(standard)).toBe(false);
    expect(isRestrictedChannel(priv)).toBe(true);
    expect(isRestrictedChannel(shared)).toBe(true);
  });
});

describe("sortTeamsChannels", () => {
  it("orders by team, then channel name", () => {
    const channels = [
      ...parseTeamChannels({ id: "t2", displayName: "Zulu" }, [
        { id: "z1", displayName: "General" },
      ]),
      ...parseTeamChannels({ id: "t1", displayName: "Alpha" }, [
        { id: "a2", displayName: "Random" },
        { id: "a1", displayName: "General" },
      ]),
    ];

    expect(
      sortTeamsChannels(channels).map((c) => `${c.teamName}/${c.name}`),
    ).toEqual(["Alpha/General", "Alpha/Random", "Zulu/General"]);
  });
});
