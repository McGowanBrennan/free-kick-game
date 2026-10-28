import { checkGolden, type Golden } from '@fk/shared';
import goldenJson from '../../shared/golden/determinism.json';

const golden = goldenJson as unknown as Golden;
const rows = checkGolden(golden);
const passed = rows.filter((r) => r.pass).length;

const summary = document.getElementById('summary')!;
summary.textContent = `${passed} / ${rows.length} scenarios match Node`;
summary.className = passed === rows.length ? 'pass' : 'fail';

const table = document.getElementById('table')!;
table.innerHTML =
  '<tr><th>Scenario</th><th>Node hash</th><th>This engine</th><th></th></tr>' +
  rows
    .map(
      (r) =>
        `<tr><td>${r.name}</td><td>${r.expected}</td><td>${r.actual}</td>` +
        `<td class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'match' : 'MISMATCH'}</td></tr>`,
    )
    .join('');

document.getElementById('ua')!.textContent = navigator.userAgent;
