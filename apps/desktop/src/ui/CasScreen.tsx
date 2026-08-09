import { useState } from 'react';
import {
  BODY_PRESETS,
  HAIR_PRESETS,
  OUTFIT_PRESETS,
  SKIN_TONES,
  loadBuiltinContent,
} from '@lifesim/content';
import { useGameStore } from '../game/store';

type MemberDraft = {
  firstName: string;
  lastName: string;
  traits: string[];
  aspirationId: string;
  visual: {
    bodyPreset: string;
    hairPreset: string;
    outfitPreset: string;
    skinTone: string;
  };
};

const emptyMember = (): MemberDraft => ({
  firstName: 'Alex',
  lastName: 'Rivera',
  traits: ['trait.cheerful'],
  aspirationId: 'aspiration.friendly',
  visual: {
    bodyPreset: 'body_a',
    hairPreset: 'hair_short',
    outfitPreset: 'outfit_casual',
    skinTone: 'tone_3',
  },
});

export function CasScreen() {
  const content = loadBuiltinContent();
  const startFromCas = useGameStore((s) => s.startFromCas);
  const [householdName, setHouseholdName] = useState('Rivera Household');
  const [members, setMembers] = useState<MemberDraft[]>([emptyMember()]);

  const update = (i: number, patch: Partial<MemberDraft>) => {
    setMembers((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };

  return (
    <div
      className="menu-screen"
      style={{ alignItems: 'start', padding: 24, overflow: 'auto' }}
    >
      <div className="menu-card" style={{ width: 'min(720px, 96vw)' }}>
        <h1>Create-A-Sim</h1>
        <p>Preset appearance only — pick looks, traits, and an aspiration.</p>

        <label style={{ display: 'block', marginBottom: 16 }}>
          Household name
          <input
            style={{ width: '100%', marginTop: 4 }}
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
          />
        </label>

        {members.map((m, i) => (
          <div
            key={i}
            style={{ borderTop: '1px solid #334155', paddingTop: 12, marginBottom: 12 }}
          >
            <div className="section-title">Sim {i + 1}</div>
            <div className="cas-grid">
              <label>
                First name
                <input
                  value={m.firstName}
                  onChange={(e) => update(i, { firstName: e.target.value })}
                />
              </label>
              <label>
                Last name
                <input
                  value={m.lastName}
                  onChange={(e) => update(i, { lastName: e.target.value })}
                />
              </label>
              <label>
                Body
                <select
                  value={m.visual.bodyPreset}
                  onChange={(e) =>
                    update(i, { visual: { ...m.visual, bodyPreset: e.target.value } })
                  }
                >
                  {BODY_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hair
                <select
                  value={m.visual.hairPreset}
                  onChange={(e) =>
                    update(i, { visual: { ...m.visual, hairPreset: e.target.value } })
                  }
                >
                  {HAIR_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Outfit
                <select
                  value={m.visual.outfitPreset}
                  onChange={(e) =>
                    update(i, { visual: { ...m.visual, outfitPreset: e.target.value } })
                  }
                >
                  {OUTFIT_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Skin
                <select
                  value={m.visual.skinTone}
                  onChange={(e) =>
                    update(i, { visual: { ...m.visual, skinTone: e.target.value } })
                  }
                >
                  {SKIN_TONES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Trait
                <select
                  value={m.traits[0]}
                  onChange={(e) => update(i, { traits: [e.target.value] })}
                >
                  {content.traits.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameKey}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Aspiration
                <select
                  value={m.aspirationId}
                  onChange={(e) => update(i, { aspirationId: e.target.value })}
                >
                  {content.aspirations.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nameKey}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {members.length < 4 && (
            <button
              type="button"
              onClick={() =>
                setMembers((ms) => [
                  ...ms,
                  {
                    ...emptyMember(),
                    firstName: 'Jordan',
                    lastName: ms[0]?.lastName ?? 'Sim',
                    visual: {
                      bodyPreset: 'body_b',
                      hairPreset: 'hair_long',
                      outfitPreset: 'outfit_pro',
                      skinTone: 'tone_2',
                    },
                  },
                ])
              }
            >
              Add Sim
            </button>
          )}
          {members.length > 1 && (
            <button type="button" onClick={() => setMembers((ms) => ms.slice(0, -1))}>
              Remove last
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => useGameStore.setState({ screen: 'menu' })}>
            Back
          </button>
          <button
            type="button"
            className="active"
            onClick={() => startFromCas(householdName, members)}
          >
            Move in
          </button>
        </div>
      </div>
    </div>
  );
}
