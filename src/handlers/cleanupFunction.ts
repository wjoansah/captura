import { S3Client, DeleteObjectCommand } from '/opt/nodejs/@aws-sdk/client-s3';
import { S3Event, Context } from 'aws-lambda';

const s3 = new S3Client({});

export const handler = async (event: S3Event, context: Context): Promise<void> => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        try {
            // Delete the original image from S3
            const deleteObjectParams = { Bucket: bucket, Key: key };
            await s3.send(new DeleteObjectCommand(deleteObjectParams));

            console.log(`Successfully deleted ${bucket}/${key}`);
        } catch (error) {
            console.error(`Error deleting ${bucket}/${key}:`, error);
        }
    }
};
