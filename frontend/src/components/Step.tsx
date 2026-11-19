import type { ReactNode } from "react";

export function Step(props: { n: number; title: string; error?: string | null; children: ReactNode }) {
  return (
    <section className="step">
      <h2>
        <span className="badge">{props.n}</span>
        {props.title}
      </h2>
      {props.children}
      {props.error && <p className="field-error">{props.error}</p>}
    </section>
  );
}
