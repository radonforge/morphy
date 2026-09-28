/**
 * Dev-only card over a "Try it" room: a private room starts only with a second
 * player, and bots never fill one, so it spells out the bot command for this
 * party code. "Back to editor" reloads the page, which leaves the room and
 * reopens the editor on the same `#editor` hash.
 */
export function TryHint({ code }: { code: string | null }) {
  const command = code ? `pnpm bot -- --code ${code} -n 1` : null;
  return (
    <div className="ed-try" role="status">
      <span className="eyebrow">Try it</span>
      {command ? (
        <>
          <span>A round needs a second player. Add a bot from a terminal:</span>
          <code className="ed-try-command">{command}</code>
        </>
      ) : (
        <span className="ed-muted">Opening a private room…</span>
      )}
      <button type="button" className="ed-btn" onClick={() => window.location.reload()}>
        Back to editor
      </button>
    </div>
  );
}
