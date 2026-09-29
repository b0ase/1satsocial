import Link from "next/link";
import { roomPath, type RoomKind } from "@/lib/room-ref";

const KIND_LABEL: Record<RoomKind, string> = { bsv21: "BSV-21", bsv20: "BSV-20", coll: "Collection" };

export function RoomCard(props: { kind: RoomKind; id: string; title: string; image: string | null; detail: string }) {
  return (
    <Link
      href={roomPath(props)}
      className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 transition hover:border-gold/50 hover:bg-panel-2"
    >
      <RoomAvatar title={props.title} image={props.image} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium group-hover:text-gold">{props.title}</span>
          <span className="shrink-0 rounded border border-line px-1.5 text-[10px] uppercase tracking-wide text-muted">
            {KIND_LABEL[props.kind]}
          </span>
        </div>
        <p className="truncate text-sm text-muted">{props.detail}</p>
      </div>
    </Link>
  );
}

export function RoomAvatar({ title, image, size = "h-11 w-11" }: { title: string; image: string | null; size?: string }) {
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-panel-2 text-sm font-semibold text-gold ${size}`}>
      {image ? (
        // Inscription content from ORDFS in arbitrary formats: plain img on purpose.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        title.replace("$", "").slice(0, 2)
      )}
    </div>
  );
}
