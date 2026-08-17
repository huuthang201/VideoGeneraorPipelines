import { Config } from '@remotion/cli/config';

/**
 * Applies to the Remotion CLI and Studio only. The programmatic renderer in
 * src/video/renderer.ts sets its own options explicitly, so the two paths stay
 * independent rather than one silently inheriting the other's defaults.
 */
Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');

// Spec §38 asks for H.264/AAC MP4. CRF 18 keeps product photos clean at 1080x1920
// without the file size a lossless setting would produce.
Config.setCrf(18);

Config.setOverwriteOutput(true);
