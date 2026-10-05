"use client";

import { useState } from "react";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function AccountContentGallery({ images, title }: { images: string[]; title: string }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  if (!images.length) return null;
  const index = Math.min(selected, images.length - 1);
  const move = (direction: number) => setSelected((index + direction + images.length) % images.length);
  return (
    <div className="amp-account-content-gallery" role="group" aria-label={t("作品图片", "Content images")}
      onKeyDown={(event) => {
        if (images.length < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }}>
      <div className="amp-account-content-gallery-stage">
        <Image src={images[index]} alt={t("{title}，第 {index} 张", "{title}, image {index}", { title, index: index + 1 })}
          width={960} height={600} unoptimized referrerPolicy="no-referrer" />
        {images.length > 1 && <>
          <button type="button" className="amp-case-gallery-arrow amp-case-gallery-arrow-prev"
            aria-label={t("上一张图片", "Previous image")} onClick={() => move(-1)}>
            <InlineIcon name="chevronRight" />
          </button>
          <button type="button" className="amp-case-gallery-arrow amp-case-gallery-arrow-next"
            aria-label={t("下一张图片", "Next image")} onClick={() => move(1)}>
            <InlineIcon name="chevronRight" />
          </button>
          <span className="amp-case-gallery-count" aria-live="polite">{index + 1} / {images.length}</span>
        </>}
      </div>
      {images.length > 1 && <div className="amp-account-content-gallery-thumbnails" aria-label={t("图片列表", "Image list")}>
        {images.map((image, imageIndex) => (
          <button key={`${imageIndex}:${image}`} type="button" aria-current={imageIndex === index}
            aria-label={t("查看第 {index} 张图片", "View image {index}", { index: imageIndex + 1 })}
            onClick={() => setSelected(imageIndex)}>
            <Image src={image} alt="" width={44} height={44} unoptimized referrerPolicy="no-referrer" />
          </button>
        ))}
      </div>}
    </div>
  );
}
