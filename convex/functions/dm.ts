import { ConvexError, v } from "convex/values";
import { authenticatedMutation, authenticatedQuery } from "./helpers";
import { QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

export const list = authenticatedQuery({
  handler: async (ctx) => {
    const directMessages = await ctx.db
      .query("directMessageMembers")
      .withIndex("by_user", (q) => q.eq("user", ctx.user._id))
      .collect();
    return await Promise.all(
      directMessages.map((dm) => getDirectMessage(ctx, dm.directMessage))
    );
  },
});

export const get = authenticatedQuery({
  args: {
    id: v.id("directMessages"),
  },
  handler: async (ctx, { id }) => {
    // verify that the user is a member of the dm
    // get dm by id, having user as current user (ctx.user._id)
    const members = await ctx.db
      .query("directMessageMembers")
      .withIndex("by_direct_message_user", (q) =>
        q.eq("directMessage", id).eq("user", ctx.user._id)
      )
      .first();
    if (!members) {
      throw new ConvexError("User is not a member of this direct message");
    }
    // if all good, return the dm object
    return await getDirectMessage(ctx, id);
  },
});

export const create = authenticatedMutation({
  args: {
    username: v.string(),
  },
  handler: async (ctx, { username }) => {
    // get the user object
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();
    if (!user) throw new Error("User not found");

    // check if message already exists
    const directMessagesForCurrentUser = await ctx.db
      .query("directMessageMembers")
      .withIndex("by_user", (q) => q.eq("user", ctx.user._id))
      .collect();
    const directMessagesForOtherUser = await ctx.db
      .query("directMessageMembers")
      .withIndex("by_user", (q) => q.eq("user", user._id))
      .collect();
    const directMessage = directMessagesForCurrentUser.find((dm) =>
      directMessagesForOtherUser.find(
        (dm2) => dm2.directMessage === dm.directMessage
      )
    );
    if (directMessage) return directMessage.directMessage;
    const newDirectMessage = await ctx.db.insert("directMessages", {});
    await Promise.all([
      ctx.db.insert("directMessageMembers", {
        directMessage: newDirectMessage,
        user: ctx.user._id,
      }),
      ctx.db.insert("directMessageMembers", {
        directMessage: newDirectMessage,
        user: user._id,
      }),
    ]);
    return newDirectMessage;
  },
});

const getDirectMessage = async (
  ctx: QueryCtx & { user: Doc<"users"> },
  id: Id<"directMessages">
) => {
  // gets the dm and the other member of the dm

  // get dm object
  const dm = await ctx.db.get(id);
  if (!dm) throw new Error("Direct message not found");

  // get the other member of the dm
  const otherMember = await ctx.db
    .query("directMessageMembers")
    .withIndex("by_direct_message", (q) => q.eq("directMessage", id))
    .filter((q) => q.neq(q.field("user"), ctx.user._id))
    .first();
  if (!otherMember) {
    throw new ConvexError("Direct message does not have another member");
  }
  const user = await ctx.db.get(otherMember.user);
  if (!user) {
    throw new ConvexError("Direct message member not found");
  }
  return {
    ...dm,
    user,
  };
};
