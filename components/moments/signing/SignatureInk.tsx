// SignatureInk — the read-only renderer of STORED signature strokes.
//
// Display = PDF (utils/moments/signatureInk.ts): every stored `d` string is
// drawn verbatim — no transform of the string, no smoothing, no taper — at the
// PDF's constant width (PDF_SIGNATURE_STROKE_WIDTH, 1.6 pad units, applied in
// the coordinate space through the viewBox) with round caps and joins, exactly
// as utils/pdfGenerator.ts buildSignatureBlock draws it.

import React from 'react';
import Svg, { Path } from 'react-native-svg';
import {
  PDF_SIGNATURE_STROKE_WIDTH,
  PDF_SIGNATURE_LINECAP,
  PDF_SIGNATURE_LINEJOIN,
  PAD_COORDINATE_WIDTH,
  PAD_COORDINATE_HEIGHT,
} from '@/utils/moments/signatureInk';

export interface SignatureInkProps {
  paths: readonly string[];
  coordinateWidth?: number;
  coordinateHeight?: number;
  width: number;
  height: number;
  color: string;
  testID?: string;
}

export function SignatureInk({
  paths,
  coordinateWidth = PAD_COORDINATE_WIDTH,
  coordinateHeight = PAD_COORDINATE_HEIGHT,
  width,
  height,
  color,
  testID,
}: SignatureInkProps) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${coordinateWidth} ${coordinateHeight}`}
      pointerEvents="none"
      testID={testID}
    >
      {paths.map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={PDF_SIGNATURE_STROKE_WIDTH}
          fill="none"
          strokeLinecap={PDF_SIGNATURE_LINECAP}
          strokeLinejoin={PDF_SIGNATURE_LINEJOIN}
        />
      ))}
    </Svg>
  );
}

export default SignatureInk;
