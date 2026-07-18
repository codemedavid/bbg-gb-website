'use client';
import { useState } from 'react';
import { SectionHeader } from '@/components/headers';
import { reconstitution } from '@/lib/calculator';

const PRESETS: [string, number, number, number][] = [
  ['Tirze 15mg · 2.5mg dose', 15, 2, 2.5],
  ['Reta 10mg · 1mg dose', 10, 2, 1],
  ['BPC 10mg · 0.25mg dose', 10, 3, 0.25],
];

function Field({ label, value, step, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-bold text-ink-body">{label}</div>
      <input type="number" step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded-[10px] border-[1.5px] border-line px-3.5 py-3 text-[16px] font-bold outline-none focus:border-brand-green" />
    </div>
  );
}

export default function CalcPage() {
  const [vial, setVial] = useState(15);
  const [bac, setBac] = useState(2);
  const [dose, setDose] = useState(2.5);
  const r = reconstitution(vial, bac, dose);

  return (
    <>
      <SectionHeader title="🧮 Recon Calculator" sub="BAC water → units on a U-100 insulin syringe" />
      <div className="p-4">
        <div className="mb-3.5 flex flex-wrap gap-2">
          {PRESETS.map(([label, v, b, d]) => (
            <button key={label} onClick={() => { setVial(v); setBac(b); setDose(d); }}
              className="rounded-full border border-line bg-white px-3.5 py-[7px] text-[12px] font-semibold text-ink-body">
              {label}
            </button>
          ))}
        </div>
        <div className="mb-3.5 flex flex-col gap-3.5 rounded-[16px] bg-white p-4 shadow-card">
          <Field label="Peptide in vial (mg)" value={vial} onChange={setVial} />
          <Field label="BAC water added (ml)" value={bac} onChange={setBac} />
          <Field label="Desired dose (mg)" value={dose} step={0.05} onChange={setDose} />
        </div>
        <div className="rounded-[16px] bg-gradient-to-br from-brand-navy to-brand-blue p-[18px] text-white">
          <div className="mb-1 text-[12px] font-bold tracking-wider opacity-80">DRAW TO</div>
          <div className="font-display text-[38px] font-bold leading-none">
            {r.units} <span className="text-[16px] font-semibold">units</span>
          </div>
          <div className="mt-3 flex gap-[18px] text-[12.5px]">
            <div><div className="opacity-70">Concentration</div><strong>{r.concentration} mg/ml</strong></div>
            <div><div className="opacity-70">Doses per vial</div><strong>{r.dosesPerVial}</strong></div>
          </div>
        </div>
        <div className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">
          For reference only. U-100 syringe: 100 units = 1 ml. Always double-check your math and consult a professional.
        </div>
      </div>
    </>
  );
}
