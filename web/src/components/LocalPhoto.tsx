import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { api } from '../lib/api';

/**
 * Foto privata letta dall'archivio del dispositivo tramite il router locale (stessi controlli di accesso della 2.0).
 * L'URL blob: vive solo finché il componente è montato: nessuna copia in cache, nessun file sul disco.
 */
export function LocalPhoto({ photoId, ...img }: { photoId: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    setFailed(false);
    api<Blob>('GET', `/photos/${photoId}`)
      .then((blob) => {
        if (!alive) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [photoId]);
  if (failed) return <div className={`photo-empty ${img.className ?? ''}`}>Foto non disponibile</div>;
  if (!url) return <div className={`photo skeleton ${img.className ?? ''}`} aria-busy="true" />;
  return <img {...img} src={url} />;
}
