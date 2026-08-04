import { useEffect, useRef } from "react";

/* Mounts a raw HTML string as-is — used for the plain-markup catalog pieces
   (action triggers, page-level compositions) that don't have a dedicated
   custom element, so the story stays byte-identical to what the app emits. */
export function Html({ markup }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = markup;
  }, [markup]);
  return <div ref={ref} />;
}
