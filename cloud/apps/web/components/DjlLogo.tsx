import Image from "next/image";

export function DjlLogo({ className = "size-10" }: { className?: string }) {
  return (
    <Image
      src="/djl-logo.png"
      alt=""
      aria-hidden="true"
      width={64}
      height={64}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
