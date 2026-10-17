import type { GamePlan } from '@shared/api';

const TEMPLATE_IDS = new Set([
  'player_movement',
  'interaction',
  'health',
  'inventory',
  'keys_doors',
  'enemy_ai',
  'flashlight',
  'random_events',
  'save_system',
  'hud',
  'main_menu',
  'pause_menu',
  'objective',
  'ambient_audio',
]);

/** Read-only rendering of a Game Plan for review. */
export function PlanView({ plan }: { plan: GamePlan }) {
  return (
    <div className="plan" data-testid="plan-view">
      <div>
        <h4>Title</h4>
        <div className="title">{plan.title}</div>
      </div>
      <div>
        <h4>Genre · Engine</h4>
        <div>
          {plan.genre} · Godot {plan.dimension.toUpperCase()} ({plan.perspective})
        </div>
      </div>
      <div className="full">
        <h4>Summary</h4>
        <div className="muted">{plan.summary}</div>
      </div>
      <div>
        <h4>Core loop</h4>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {plan.coreLoop.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>
      <div>
        <h4>Features</h4>
        <ul>
          {plan.features.map((f) => (
            <li key={f.id}>
              {f.name}
              {!TEMPLATE_IDS.has(f.id) && (
                <span
                  className="badge blue"
                  style={{ marginLeft: 6 }}
                  title="No tested template — implemented by the Programmer agent"
                >
                  AI
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>Level</h4>
        <div>
          {plan.level.name} — {plan.level.rooms} rooms, {plan.level.keys} keys
        </div>
      </div>
      <div>
        <h4>Enemies</h4>
        {plan.enemies.length === 0 ? (
          <div className="muted">None</div>
        ) : (
          plan.enemies.map((e) => (
            <div key={e.name}>
              {e.count}× {e.name}{' '}
              <span className="faint">
                ({e.behavior}, speed {e.speed}, damage {e.damage})
              </span>
            </div>
          ))
        )}
      </div>
      <div>
        <h4>Player</h4>
        <div>
          Walk {plan.player.moveSpeed} · Sprint {plan.player.sprintSpeed} · Health{' '}
          {plan.player.maxHealth}
        </div>
      </div>
      <div>
        <h4>Multiplayer</h4>
        <div>
          {plan.multiplayer.enabled
            ? `Up to ${plan.multiplayer.maxPlayers} players`
            : 'Single player'}
        </div>
      </div>
      {plan.notes.length > 0 && (
        <div className="full">
          <h4>Notes</h4>
          <ul>
            {plan.notes.map((n, i) => (
              <li key={i} className="muted">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
