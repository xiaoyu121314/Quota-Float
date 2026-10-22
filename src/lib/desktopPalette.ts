import type { CSSProperties } from "react";
import type { WidgetTheme } from "../types";

export type DesktopPaletteName = "healthy" | "caution" | "critical" | "unavailable" | "stale" | "signed_out";
export type DesktopPaletteStyle = CSSProperties & {
  "--cool": string;
  "--glow": string;
  "--warm": string;
  "--progress-start": string;
  "--progress-end": string;
  "--glow-fade"?: string;
  "--warm-position"?: string;
  "--warm-fade"?: string;
  "--linear-warm"?: string;
  "--linear-end"?: string;
  "--gradient-angle"?: string;
  "--aurora-opacity"?: string;
};

export type DesktopPalettes = Record<DesktopPaletteName, DesktopPaletteStyle>;

// Runtime source of truth for every production desktop palette. The design
// workbench reads this object and never reads, writes, or persists its own
// palette values. Keep light and dark as separate records: changing one theme
// must never alter the other theme's desktop rendering.
//
// Light values intentionally match the v0.1.5 release visual baseline.
export const DESKTOP_PALETTES: Record<WidgetTheme, DesktopPalettes> = {
  light: {
    healthy: { "--cool": "#B9D5EE", "--glow": "#DFF4E5", "--warm": "#C7DDF2", "--progress-start": "#397AE0", "--progress-end": "#91BAF0", "--aurora-opacity": ".42" },
    caution: { "--cool": "#B7D0EC", "--glow": "#FFF0BA", "--warm": "#F4C979", "--progress-start": "#4D88D8", "--progress-end": "#9FC2EE", "--glow-fade": "58%", "--warm-position": "12% 96%", "--warm-fade": "66%", "--linear-warm": "#E4E7ED", "--linear-end": "#F1F5F8", "--gradient-angle": "213deg", "--aurora-opacity": ".5" },
    critical: { "--cool": "#C4CEE0", "--glow": "#FFD8A8", "--warm": "#F07260", "--progress-start": "#FF7848", "--progress-end": "#FFD064", "--glow-fade": "60%", "--warm-position": "11% 98%", "--warm-fade": "68%", "--linear-warm": "#E3E4E9", "--linear-end": "#F3F5F8", "--gradient-angle": "213deg", "--aurora-opacity": ".56" },
    unavailable: { "--cool": "#849CD6", "--glow": "#FFF4C3", "--warm": "#FF9A4E", "--progress-start": "#397AE0", "--progress-end": "#89B7FF" },
    stale: { "--cool": "#849CD6", "--glow": "#FFF4C3", "--warm": "#FF9A4E", "--progress-start": "#397AE0", "--progress-end": "#89B7FF" },
    signed_out: { "--cool": "#688CD4", "--glow": "#D7EEF3", "--warm": "#D89CA5", "--progress-start": "#397AE0", "--progress-end": "#89B7FF", "--linear-warm": "#BECBE2", "--linear-end": "#E3EAF4", "--gradient-angle": "145deg", "--aurora-opacity": ".58" },
  },
  dark: {
    healthy: { "--cool": "#272B59", "--glow": "#1C2240", "--warm": "#071231", "--progress-start": "#177CBB", "--progress-end": "#5DA6D1", "--linear-warm": "#071231", "--linear-end": "#071231", "--aurora-opacity": "1" },
    caution: { "--cool": "#26294B", "--glow": "#3C2F25", "--warm": "#09132F", "--progress-start": "#BD9252", "--progress-end": "#DEC299", "--linear-warm": "#09132F", "--linear-end": "#09132F", "--aurora-opacity": "1" },
    critical: { "--cool": "#0F1D39", "--glow": "#50322B", "--warm": "#09132F", "--progress-start": "#CE7253", "--progress-end": "#E6A38D", "--warm-position": "11% 98%", "--warm-fade": "68%", "--linear-warm": "#09132F", "--linear-end": "#09132F", "--gradient-angle": "213deg", "--aurora-opacity": "1" },
    unavailable: { "--cool": "#2B4478", "--glow": "#5F3549", "--warm": "#3D2353", "--progress-start": "#6072A2", "--progress-end": "#92A4C5" },
    stale: { "--cool": "#273748", "--glow": "#455569", "--warm": "#2B3340", "--progress-start": "#71849A", "--progress-end": "#A4B3C1" },
    signed_out: { "--cool": "#2D3864", "--glow": "#31445A", "--warm": "#5B3B55", "--progress-start": "#5864DE", "--progress-end": "#7D88F2", "--linear-warm": "#353650", "--linear-end": "#1D2534", "--aurora-opacity": "1" },
  },
  // Sakura Night stays independent from the generic dark palette. The
  // background image supplies blossom detail while these state records keep
  // progress and error states readable and data-driven.
  sakura: {
    healthy: { "--cool": "#3B2A38", "--glow": "#6B4A5A", "--warm": "#4B3441", "--progress-start": "#C9799A", "--progress-end": "#E7A9BD", "--glow-fade": "58%", "--warm-position": "89% 84%", "--warm-fade": "45%", "--linear-warm": "#3C2936", "--linear-end": "#241821", "--gradient-angle": "145deg", "--aurora-opacity": ".62" },
    caution: { "--cool": "#40303F", "--glow": "#715A50", "--warm": "#4A3440", "--progress-start": "#C88A9F", "--progress-end": "#E6B7C4", "--glow-fade": "60%", "--warm-position": "88% 84%", "--warm-fade": "46%", "--linear-warm": "#3E2B37", "--linear-end": "#271B24", "--gradient-angle": "145deg", "--aurora-opacity": ".64" },
    critical: { "--cool": "#472E3A", "--glow": "#80525A", "--warm": "#4B2936", "--progress-start": "#D77F96", "--progress-end": "#EEB0BC", "--glow-fade": "62%", "--warm-position": "88% 84%", "--warm-fade": "48%", "--linear-warm": "#402532", "--linear-end": "#281921", "--gradient-angle": "145deg", "--aurora-opacity": ".66" },
    unavailable: { "--cool": "#3A2E3B", "--glow": "#594451", "--warm": "#3C2D38", "--progress-start": "#B47F98", "--progress-end": "#D6A8BA", "--linear-warm": "#352631", "--linear-end": "#241922", "--aurora-opacity": ".6" },
    stale: { "--cool": "#38323B", "--glow": "#5A5059", "--warm": "#3D343D", "--progress-start": "#9D8E9D", "--progress-end": "#C5B6C1", "--linear-warm": "#373039", "--linear-end": "#29222A", "--aurora-opacity": ".56" },
    signed_out: { "--cool": "#40364D", "--glow": "#625064", "--warm": "#493746", "--progress-start": "#A996D0", "--progress-end": "#D0B6DE", "--linear-warm": "#3D3047", "--linear-end": "#28202F", "--aurora-opacity": ".6" },
  },
  // Warm Daily Orange keeps the supplied café scene visible under a cream
  // glass tint. The state records only drive readable status/progress tokens;
  // the photo asset itself is shared by the expanded card and compact orb.
  warm: {
    healthy: { "--cool": "#F2D4B4", "--glow": "#FFE8C9", "--warm": "#F2A46B", "--progress-start": "#FF6039", "--progress-end": "#FFB25D", "--glow-fade": "58%", "--warm-position": "88% 86%", "--warm-fade": "50%", "--linear-warm": "#F2BF8D", "--linear-end": "#F8E4CD", "--gradient-angle": "145deg", "--aurora-opacity": ".3" },
    caution: { "--cool": "#F0D0A8", "--glow": "#FFE0A3", "--warm": "#ED9250", "--progress-start": "#F37A2F", "--progress-end": "#FFC46B", "--glow-fade": "60%", "--warm-position": "88% 86%", "--warm-fade": "52%", "--linear-warm": "#F1B47B", "--linear-end": "#F6DEC1", "--gradient-angle": "145deg", "--aurora-opacity": ".34" },
    critical: { "--cool": "#E8C2A2", "--glow": "#FFD0A6", "--warm": "#D96D43", "--progress-start": "#EF5130", "--progress-end": "#FFB765", "--glow-fade": "62%", "--warm-position": "88% 86%", "--warm-fade": "54%", "--linear-warm": "#EBAA77", "--linear-end": "#F4D9BC", "--gradient-angle": "145deg", "--aurora-opacity": ".36" },
    unavailable: { "--cool": "#D6BFAE", "--glow": "#F5D7B7", "--warm": "#C87F64", "--progress-start": "#C56A4B", "--progress-end": "#E5A785", "--linear-warm": "#DAB9A3", "--linear-end": "#F0DFCE", "--aurora-opacity": ".3" },
    stale: { "--cool": "#D7C7BA", "--glow": "#EBD9C8", "--warm": "#BBA092", "--progress-start": "#A98777", "--progress-end": "#D1B4A2", "--linear-warm": "#D4C1B5", "--linear-end": "#EEE1D5", "--aurora-opacity": ".26" },
    signed_out: { "--cool": "#D9C1B7", "--glow": "#EED1C6", "--warm": "#B97561", "--progress-start": "#B66A58", "--progress-end": "#D39A85", "--linear-warm": "#D8B9A9", "--linear-end": "#F0DED4", "--aurora-opacity": ".3" },
  },
  // City Dusk Purple keeps the skyline/cat photograph behind a dark glass
  // layer. Lavender progress tokens distinguish quota state without losing
  // the quiet indigo night mood of the reference.
  city: {
    healthy: { "--cool": "#32276E", "--glow": "#68429A", "--warm": "#151A4C", "--progress-start": "#C06DEB", "--progress-end": "#F0B0EF", "--glow-fade": "58%", "--warm-position": "89% 86%", "--warm-fade": "48%", "--linear-warm": "#1C194F", "--linear-end": "#10162F", "--gradient-angle": "145deg", "--aurora-opacity": ".58" },
    caution: { "--cool": "#392B72", "--glow": "#76508D", "--warm": "#1A194A", "--progress-start": "#9A7AE8", "--progress-end": "#E8B4E5", "--glow-fade": "60%", "--warm-position": "89% 86%", "--warm-fade": "50%", "--linear-warm": "#211A4B", "--linear-end": "#121632", "--gradient-angle": "145deg", "--aurora-opacity": ".6" },
    critical: { "--cool": "#49286E", "--glow": "#8B4C8B", "--warm": "#21163F", "--progress-start": "#E47EBB", "--progress-end": "#F3B9E4", "--glow-fade": "62%", "--warm-position": "89% 86%", "--warm-fade": "52%", "--linear-warm": "#29183F", "--linear-end": "#17152D", "--gradient-angle": "145deg", "--aurora-opacity": ".64" },
    unavailable: { "--cool": "#2A2B60", "--glow": "#5B417D", "--warm": "#1A1B46", "--progress-start": "#7F7EC5", "--progress-end": "#B7A5DF", "--linear-warm": "#202047", "--linear-end": "#13172F", "--aurora-opacity": ".54" },
    stale: { "--cool": "#283653", "--glow": "#4D547D", "--warm": "#1A2441", "--progress-start": "#7185B8", "--progress-end": "#AAB9D7", "--linear-warm": "#202C48", "--linear-end": "#172039", "--aurora-opacity": ".48" },
    signed_out: { "--cool": "#3A2B65", "--glow": "#624B80", "--warm": "#241A4A", "--progress-start": "#A78DDF", "--progress-end": "#D3B8F0", "--linear-warm": "#2B204F", "--linear-end": "#19182F", "--aurora-opacity": ".56" },
  },
  // 冰川极光的六种状态独立维护；青色用于健康额度，琥珀/赭红保留
  // 低额度提醒的辨识度。背景始终复用同一张冰川图，不随状态替换。
  glacier: {
    healthy: { "--cool": "#EEF6F8", "--glow": "#B6DDE4", "--warm": "#CDEEEB", "--progress-start": "#258899", "--progress-end": "#5BAFB5", "--aurora-opacity": ".08" },
    caution: { "--cool": "#EEF6F8", "--glow": "#D9E6DE", "--warm": "#EBD9B5", "--progress-start": "#95631E", "--progress-end": "#B58B45", "--aurora-opacity": ".1" },
    critical: { "--cool": "#EEF6F8", "--glow": "#E8D8D7", "--warm": "#EAC8BE", "--progress-start": "#B34D43", "--progress-end": "#C77460", "--aurora-opacity": ".12" },
    unavailable: { "--cool": "#E6EFF2", "--glow": "#C7DCE1", "--warm": "#CBDDDE", "--progress-start": "#526F7B", "--progress-end": "#7596A1", "--aurora-opacity": ".08" },
    stale: { "--cool": "#E7EFF2", "--glow": "#D0DDE1", "--warm": "#D6E2E3", "--progress-start": "#5C747E", "--progress-end": "#849BA4", "--aurora-opacity": ".06" },
    signed_out: { "--cool": "#EAF2F5", "--glow": "#CCDDE9", "--warm": "#D3E7E9", "--progress-start": "#416F8B", "--progress-end": "#729DB2", "--aurora-opacity": ".08" },
  },
  yone: {
    healthy: { "--cool": "#F3BDD5", "--glow": "#ACDCEC", "--warm": "#EAB1D2", "--progress-start": "#B43B78", "--progress-end": "#8466B4", "--aurora-opacity": ".12" },
    caution: { "--cool": "#EFC0DB", "--glow": "#C6ACE7", "--warm": "#E4A8CB", "--progress-start": "#7754A8", "--progress-end": "#A95895", "--aurora-opacity": ".16" },
    critical: { "--cool": "#F1B2CB", "--glow": "#F1A6C4", "--warm": "#DF91B4", "--progress-start": "#A82B62", "--progress-end": "#CA558D", "--aurora-opacity": ".2" },
    unavailable: { "--cool": "#E9BED2", "--glow": "#D6B2D6", "--warm": "#D8A7C2", "--progress-start": "#94627E", "--progress-end": "#A8799D", "--aurora-opacity": ".14" },
    stale: { "--cool": "#E7CBD8", "--glow": "#C9C2DB", "--warm": "#D5B4C9", "--progress-start": "#796A83", "--progress-end": "#9C87A5", "--aurora-opacity": ".12" },
    signed_out: { "--cool": "#EDC2DC", "--glow": "#C8B5E8", "--warm": "#DDAFCE", "--progress-start": "#84609E", "--progress-end": "#AE6C9D", "--aurora-opacity": ".14" },
  },
  naruto: {
    healthy: { "--cool": "#171516", "--glow": "#6B4115", "--warm": "#241809", "--progress-start": "#FF982F", "--progress-end": "#FFD45A", "--aurora-opacity": ".18" },
    caution: { "--cool": "#19140F", "--glow": "#7A3F16", "--warm": "#2B190D", "--progress-start": "#F47B26", "--progress-end": "#FFAD46", "--aurora-opacity": ".2" },
    critical: { "--cool": "#1C1210", "--glow": "#842D1A", "--warm": "#30150D", "--progress-start": "#F05C3B", "--progress-end": "#FF8550", "--aurora-opacity": ".22" },
    unavailable: { "--cool": "#191512", "--glow": "#654128", "--warm": "#281A13", "--progress-start": "#CE9160", "--progress-end": "#E7B985", "--aurora-opacity": ".14" },
    stale: { "--cool": "#181615", "--glow": "#494035", "--warm": "#211C17", "--progress-start": "#A69880", "--progress-end": "#CCBDA3", "--aurora-opacity": ".12" },
    signed_out: { "--cool": "#1B160E", "--glow": "#615022", "--warm": "#28200F", "--progress-start": "#C5A34F", "--progress-end": "#E6CB85", "--aurora-opacity": ".14" },
  },
  // 云间灵尾复用灵魂莲华阿狸的云上灵域参考图。浅粉云海之上以梅子粉
  // 进度色保持额度可读，低额度状态加深避免与云层高光混在一起。
  yunlin: {
    healthy: { "--cool": "#F9E9F3", "--glow": "#F6D9ED", "--warm": "#F3CCE6", "--progress-start": "#C95FA2", "--progress-end": "#EFB0D8", "--aurora-opacity": ".14" },
    caution: { "--cool": "#F7E4EC", "--glow": "#F3D5DE", "--warm": "#EFC4D2", "--progress-start": "#B4608C", "--progress-end": "#D993BC", "--aurora-opacity": ".16" },
    critical: { "--cool": "#F6DDE4", "--glow": "#F2CBD6", "--warm": "#E9B4C2", "--progress-start": "#C4477E", "--progress-end": "#E284AE", "--aurora-opacity": ".18" },
    unavailable: { "--cool": "#F5E6EE", "--glow": "#E7D2DF", "--warm": "#DFC2D2", "--progress-start": "#A87692", "--progress-end": "#CBA6BC", "--aurora-opacity": ".12" },
    stale: { "--cool": "#F2E8ED", "--glow": "#DFD5DC", "--warm": "#D6C6CF", "--progress-start": "#9A8090", "--progress-end": "#BCA6B4", "--aurora-opacity": ".1" },
    signed_out: { "--cool": "#F5E5F0", "--glow": "#E8D0E2", "--warm": "#DDBCD4", "--progress-start": "#9C6BA0", "--progress-end": "#C89BC8", "--aurora-opacity": ".12" },
  },
  // Home Night uses the indoor reference as its visual anchor. The warmer
  // plum status records keep quota changes legible without flattening the
  // lamp, window, cat, and mug into a generic dark-mode surface.
  home: {
    healthy: { "--cool": "#302036", "--glow": "#6A3D50", "--warm": "#24182B", "--progress-start": "#D66C9A", "--progress-end": "#F4A9C7", "--glow-fade": "58%", "--warm-position": "86% 84%", "--warm-fade": "48%", "--linear-warm": "#2A182B", "--linear-end": "#160F1A", "--gradient-angle": "145deg", "--aurora-opacity": ".56" },
    caution: { "--cool": "#39233B", "--glow": "#7A4753", "--warm": "#29182C", "--progress-start": "#C47C9F", "--progress-end": "#EEB5C9", "--glow-fade": "60%", "--warm-position": "86% 84%", "--warm-fade": "50%", "--linear-warm": "#301A2D", "--linear-end": "#19101D", "--gradient-angle": "145deg", "--aurora-opacity": ".6" },
    critical: { "--cool": "#452437", "--glow": "#8A4A58", "--warm": "#2B1627", "--progress-start": "#E26788", "--progress-end": "#F3A3BB", "--glow-fade": "62%", "--warm-position": "86% 84%", "--warm-fade": "52%", "--linear-warm": "#35182B", "--linear-end": "#1D101B", "--gradient-angle": "145deg", "--aurora-opacity": ".64" },
    unavailable: { "--cool": "#35283A", "--glow": "#634553", "--warm": "#261B2D", "--progress-start": "#A47497", "--progress-end": "#CBA8BA", "--linear-warm": "#2C2030", "--linear-end": "#19141E", "--aurora-opacity": ".5" },
    stale: { "--cool": "#33303A", "--glow": "#53505E", "--warm": "#252631", "--progress-start": "#85839B", "--progress-end": "#B7B2C0", "--linear-warm": "#2C2C38", "--linear-end": "#1B1D29", "--aurora-opacity": ".44" },
    signed_out: { "--cool": "#3D2B4B", "--glow": "#624764", "--warm": "#281A3A", "--progress-start": "#B393D7", "--progress-end": "#D6B8E6", "--linear-warm": "#322044", "--linear-end": "#1B1328", "--aurora-opacity": ".54" },
  },
};
