'use client';
import { AlertTriangle, Layers } from 'lucide-react';
import { useModelInfo, usePredictionDetail } from '@/hooks/data';
import { formatDate } from '@/lib/time/dates';
import { CATEGORY, probabilityBand } from '@/lib/science/categories';
import { shortH3 } from '@/lib/geo/h3';
import { useStore } from '@/state/store';
import { ContributionBars, Gauge, MiniHistogram } from '@/components/charts/charts';
import { Note, SectionTitle } from '@/components/ui/primitives';
import type { TargetInfo } from './useTarget';
import { env } from '@/config/env';

const fmtMetric = (v: number | null) => (v === null ? '—' : v.toFixed(2));

export function PredictionModule({ info }: { info: TargetInfo }) {
  const date = useStore((s) => s.date);
  const setLayer = useStore((s) => s.setLayer);
  const layer = useStore((s) => s.layer);
  const select = useStore((s) => s.select);
  const { data: detail, isFetching } = usePredictionDetail(info.target, date);
  const { data: model } = useModelInfo();
  const p = detail?.probability ?? null;
  const band = p === null ? null : probabilityBand(p);
  const isRegion = info.kind === 'region' || (detail?.distribution?.length ?? 0) > 0;

  if (env.dataMode === 'api') return <div className="module"><Note>Predicción no disponible: todavía no existe un modelo entrenado.</Note></div>;
  if (!detail && isFetching) {
    return (
      <div className="module">
        <p className="muted small" role="status">Calculando el pronóstico experimental…</p>
      </div>
    );
  }

  return (
    <div className="module">
      <div className="forecast-head" data-holo-item>
        <div className="forecast-head__gauge">
          <Gauge value={p} label="Probabilidad experimental" />
          <span className="muted small">{isRegion ? 'máxima entre celdas' : 'para la celda'}</span>
        </div>
        <dl className="kv kv--tight">
          <div><dt>Pronóstico para</dt><dd>{detail ? formatDate(detail.forecastDate) : '—'}</dd></div>
          <div><dt>Con datos hasta</dt><dd>{detail ? `${formatDate(detail.issuedForDate)} (cierre del día t)` : '—'}</dd></div>
          <div><dt>Nivel</dt><dd style={{ color: CATEGORY.forecast.color }}>{band?.label ?? 'Sin pronóstico'}</dd></div>
          {isRegion && detail?.meanProbability !== undefined && <div><dt>Media regional</dt><dd>{Math.round(detail.meanProbability * 100)} %</dd></div>}
          <div><dt>Modelo</dt><dd className="mono">{detail?.modelVersion ?? model?.model_version ?? '—'}</dd></div>
        </dl>
      </div>

      <div className="warning-card" data-holo-item role="note">
        <AlertTriangle size={16} aria-hidden="true" />
        <p>
          <strong>Uso experimental.</strong> Estima la probabilidad de actividad térmica <em>detectada</em> al día
          siguiente, no la ignición de nuevos incendios. No es una alerta operativa de seguridad ni debe usarse para
          proteger vidas o bienes.
        </p>
      </div>

      <div className={isFetching ? 'is-loading' : ''} data-holo-item>
        <SectionTitle aside={<span className="muted small">aporte al logit</span>}>Variables utilizadas</SectionTitle>
        {detail?.features.length ? (
          <ContributionBars
            items={detail.features.map((f) => ({
              label: f.label,
              contribution: f.contribution,
              value: f.value === null ? '—' : `${f.value.toFixed(f.unit === '0–1' ? 2 : 1)} ${f.unit ?? ''}`.trim(),
            }))}
          />
        ) : (
          <p className="muted small">El backend no devolvió variables para este objetivo.</p>
        )}
        {isRegion && <p className="muted small">En regiones y celdas agregadas se muestran valores medios de una muestra de celdas.</p>}
      </div>

      {isRegion && detail?.distribution && (
        <div className="split" data-holo-item>
          <div>
            <SectionTitle>Distribución por celda</SectionTitle>
            <MiniHistogram bins={detail.distribution} label="Histograma de probabilidades por celda" />
            <div className="hist-axis"><span>0 %</span><span>50 %</span><span>100 %</span></div>
          </div>
          <div>
            <SectionTitle>Celdas con mayor probabilidad</SectionTitle>
            <ol className="rank-list">
              {detail.topCells?.map((c) => (
                <li key={c.h3}>
                  <button type="button" onClick={() => info.region && select({ kind: 'cell', h3: c.h3, regionId: info.region.id, resolution: 6 }, { tab: 'prediction' })}>
                    <span className="mono">{shortH3(c.h3)}</span>
                    <span className="rank-list__bar"><i style={{ width: `${c.probability * 100}%` }} /></span>
                    <span>{Math.round(c.probability * 100)} %</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <div data-holo-item>
        <SectionTitle aside={<span className="badge badge--pending">pendiente</span>}>Métricas de validación</SectionTitle>
        <table className="data-table">
          <thead>
            <tr><th>Métrica</th><th>Modelo</th><th>Baseline estacional</th></tr>
          </thead>
          <tbody>
            {([['Precision', 'precision'], ['Recall', 'recall'], ['F1', 'f1'], ['PR-AUC', 'prAuc'], ['Brier (calibración)', 'brier']] as const).map(([label, key]) => (
              <tr key={key}>
                <th>{label}</th>
                <td>{fmtMetric(model?.metrics[key] ?? null)}</td>
                <td>{fmtMetric(model?.baselineMetrics[key] ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note tone="demo">
          {model?.notes[0] ?? 'Las métricas se completarán con la evaluación cronológica.'} Entrenamiento {model?.trainingPeriod ?? '—'},
          validación {model?.validationPeriod ?? '—'}, prueba {model?.testPeriod ?? '—'}.
        </Note>
      </div>

      {layer !== 'prediction' && (
        <div className="action-row" data-holo-item>
          <button type="button" className="btn btn--violet" onClick={() => setLayer('prediction')}>
            <Layers size={14} /> Ver capa de predicción en el globo
          </button>
        </div>
      )}
    </div>
  );
}
