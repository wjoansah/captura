import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    PutObjectCommandInput,
} from '/opt/nodejs/node_modules/@aws-sdk/client-s3';
import { S3Event, Context } from 'aws-lambda';
import { BlendMode, Jimp, JimpMime, loadFont, measureText, measureTextHeight } from '/opt/nodejs/node_modules/jimp';
import { SANS_32_WHITE } from '/opt/nodejs/node_modules/@jimp/plugin-print/src/fonts';

const s3 = new S3Client({});

export const handler = async (event: S3Event, context: Context): Promise<void> => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        try {
            // Retrieve the image from S3
            const getObjectParams = { Bucket: bucket, Key: key };
            const { Body } = await s3.send(new GetObjectCommand(getObjectParams));

            if (!Body) {
                console.error(`No content found at ${bucket}/${key}`);
                continue;
            }

            // Read the image with Jimp
            const image = await Jimp.read(new Uint8Array(await Body.transformToByteArray()));

            // Create watermark text
            const watermarkText = 'Ze Watermark';
            const font = await loadFont(SANS_32_WHITE);
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
            const modifiedImageBuffer = await image.getBuffer(JimpMime.jpeg);

            // Define the destination key for the processed image
            const destinationKey = `processed/${key}`;

            // Upload the modified image back to S3
            const putObjectParams: PutObjectCommandInput = {
                Bucket: bucket,
                Key: destinationKey,
                Body: modifiedImageBuffer,
                ContentType: 'image/jpeg',
            };
            await s3.send(new PutObjectCommand(putObjectParams));

            console.log(`Successfully processed and uploaded ${destinationKey}`);
        } catch (error) {
            console.error(`Error processing ${bucket}/${key}:`, error);
        }
    }
};
