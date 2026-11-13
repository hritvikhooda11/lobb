// Forwards mail sent to support@getlobb.com to every inbox in the FORWARD_TO secret (comma-separated).
export default {
  async email(message, env) {
    const inboxes = (env.FORWARD_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const results = await Promise.allSettled(inboxes.map((to) => message.forward(to)));
    results.forEach((r, i) => r.status === 'rejected' && console.error('forward failed', i, r.reason?.message));
    if (!results.some((r) => r.status === 'fulfilled')) message.setReject('Support inbox unavailable, please try again later.');
  },
};
