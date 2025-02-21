import { S3Client, DeleteObjectCommand } from '/opt/nodejs/node_modules/@aws-sdk/client-s3';
import { Context } from 'aws-lambda';
import { ImageProcessingResult } from './processImageFunction';

const s3 = new S3Client({});

export const handler = async (event: ImageProcessingResult, context: Context): Promise<void> => {
    console.log('event', event);
    if (!event) {
        console.warn('event body is empty');
        return;
    }
    const bucket = event.bucket;
    const key = decodeURIComponent(event.key.replace(/\+/g, ' '));

    try {
        // Delete the original image from S3
        const deleteObjectParams = { Bucket: bucket, Key: key };
        await s3.send(new DeleteObjectCommand(deleteObjectParams));

        console.log(`Successfully deleted ${bucket}/${key}`);
    } catch (error) {
        console.error(`Error deleting ${bucket}/${key}:`, error);
    }
};
