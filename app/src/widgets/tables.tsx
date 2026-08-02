import type { FieldRow, I18nRow, Inline } from "../contract";
import { FileStatusIcon, Octicon } from "../ui/octicon";
import { Rich, Tag } from "../ui/rich";
import { useStrings } from "../ui/strings";

const shell = "my-4 border border-border rounded-md overflow-x-auto";
const head = "bg-card text-left text-muted-foreground";

export function Fields({ rows }: { rows: FieldRow[] }) {
  const strings = useStrings();
  return (
    <div className={shell}>
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className={head}>
            {strings.fieldsHead.map((label) => (
              <th key={label} className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border-soft align-top">
              <td className="px-3 py-2 font-mono whitespace-nowrap text-foreground">
                {row.name}
                {row.badges?.map((badge) => (
                  <span
                    key={badge}
                    className="ml-2 text-[10.5px] font-sans text-done bg-done/12 border border-done/32 rounded-md px-[5px] py-[1px]"
                  >
                    {badge}
                  </span>
                ))}
              </td>
              <td className="px-3 py-2 font-mono whitespace-nowrap text-accent-muted">
                {row.kind}
              </td>
              <td className="px-3 py-2 text-secondary-foreground leading-relaxed">
                <Rich v={row.note} />
                {row.tags !== undefined && row.tags.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {row.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Matrix({
  head: columns,
  rows,
}: {
  head: string[];
  rows: { label: string; cells: boolean[] }[];
}) {
  return (
    <div className={shell}>
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className={head}>
            {columns.map((label, index) => (
              <th
                key={label}
                className={`px-3 py-2 font-medium ${index > 0 ? "text-center w-20" : ""}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border-soft">
              <td className="px-3 py-2 font-mono whitespace-nowrap text-foreground">{row.label}</td>
              {row.cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 text-center">
                  <Octicon
                    name={cell ? "check" : "dash"}
                    size={14}
                    className={cell ? "text-added" : "text-context"}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataTable({
  head: columns,
  rows,
  firstColMono,
}: {
  head: Inline[][];
  rows: Inline[][][];
  firstColMono?: boolean;
}) {
  return (
    <div className={shell}>
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className={head}>
            {columns.map((cell, index) => (
              <th key={index} className="px-3 py-2 font-medium">
                <Rich v={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border-soft align-top">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-3 py-2 leading-relaxed ${
                    cellIndex === 0 && firstColMono === true
                      ? "font-mono whitespace-nowrap text-foreground"
                      : "text-secondary-foreground"
                  }`}
                >
                  <Rich v={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function I18nTable({ rows, note }: { rows: I18nRow[]; note?: Inline[] }) {
  const strings = useStrings();
  return (
    <div className="my-4">
      <div className="border border-border rounded-md overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className={head}>
              {strings.i18nHead.map((label) => (
                <th key={label} className="px-3 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-border-soft">
                <td className="px-3 py-2 font-mono text-foreground">
                  <span className="inline-flex items-center gap-2">
                    <FileStatusIcon status={row.status} />
                    {row.path}
                  </span>
                  {row.note !== undefined && (
                    <span className="ml-2 font-sans text-[12px] text-muted-foreground">
                      ({row.note})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.lang !== undefined ? (
                    <Tag>{row.lang}</Tag>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">
                  <span className="text-added">+{row.additions}</span>{" "}
                  <span className="text-context">−{row.deletions}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.entries.new !== undefined && (
                    <span className="text-added">
                      {row.entries.new} {strings.entries.new}
                    </span>
                  )}
                  {row.entries.updated !== undefined && (
                    <span className="text-modified ml-2">
                      {row.entries.updated} {strings.entries.updated}
                    </span>
                  )}
                  {row.entries.removed !== undefined && (
                    <span className="text-removed ml-2">
                      {row.entries.removed} {strings.entries.removed}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note !== undefined && (
        <p className="mt-2 text-[12.5px] text-muted-foreground leading-relaxed">
          <Rich v={note} />
        </p>
      )}
    </div>
  );
}
