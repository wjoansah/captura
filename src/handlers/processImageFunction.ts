import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    PutObjectCommandInput,
} from '/opt/nodejs/node_modules/@aws-sdk/client-s3';
import { Context, S3ObjectCreatedNotificationEvent } from 'aws-lambda';
import { BlendMode, Jimp, JimpMime, loadFont, measureText, measureTextHeight } from '/opt/nodejs/node_modules/jimp';

const s3 = new S3Client({});
const PRIMARY_BUCKET_NAME = process.env.PRIMARY_BUCKET_NAME!;

export interface ImageProcessingResult {
    bucket: string;
    key: string;
    message?: string;
}

export const handler = async (
    event: S3ObjectCreatedNotificationEvent,
    context: Context,
): Promise<ImageProcessingResult | undefined> => {
    const bucket = event.detail.bucket.name;
    const key = decodeURIComponent(event.detail.object.key.replace(/\+/g, ' '));

    try {
        // Retrieve the image from S3
        const getObjectParams = { Bucket: bucket, Key: key };
        const { Body, ContentType } = await s3.send(new GetObjectCommand(getObjectParams));

        if (!Body) {
            console.error(`No content found at ${bucket}/${key}`);
            return undefined;
        }

        // Read the image with Jimp
        const image = await Jimp.read(new Uint8Array(await Body.transformToByteArray()));

        // Create watermark text
        const watermarkText = 'Ze Watermark';
        const font = await loadFont(Jimp.FONT_SANS_32_WHITE);
        const textWidth = measureText(font, watermarkText);
        const textHeight = measureTextHeight(font, watermarkText, textWidth);

        // Create a new image for the watermark
        const watermark = new Jimp({ height: textHeight, width: textWidth });
        // watermark.print(font, 0, 0, watermarkText);
        watermark.print({ font, x: 0, y: 0, text: watermarkText });

        // Position the watermark at the bottom-right corner
        const x = image.bitmap.width - watermark.bitmap.width - 10;
        const y = image.bitmap.height - watermark.bitmap.height - 10;

        // Composite the watermark onto the original image
        image.composite(watermark, x, y, {
            mode: BlendMode.SRC_OVER,
            opacitySource: 0.5,
        });

        // Get the buffer of the modified image
        if (!ContentType) {
            console.error('image has no content type');
            return undefined;
        }
        const mime = getMimeType(ContentType);

        if (!mime) {
            console.error('unsupported mime type');
            return undefined;
        }
        const modifiedImageBuffer = await image.getBuffer(mime);

        // Upload the modified image back to S3
        const putObjectParams: PutObjectCommandInput = {
            Bucket: PRIMARY_BUCKET_NAME,
            Key: key,
            Body: modifiedImageBuffer,
            ContentType,
        };
        await s3.send(new PutObjectCommand(putObjectParams));
        console.log(`Successfully processed and uploaded ${key}`);

        return {
            bucket,
            key,
        };
    } catch (error) {
        console.error(`Error processing ${bucket}/${key}:`, error);
    }
};

const getMimeType = (contentType: string) => {
    switch (contentType) {
        case 'image/png':
            return JimpMime.png;
        case 'image/jpg':
        case 'image/jpeg':
            return JimpMime.jpeg;
        case 'image/gif':
            return JimpMime.gif;
        case 'image/tiff':
            return JimpMime.tiff;
        case 'image/bmp':
            return JimpMime.bmp;
        default:
            return null;
    }
};
