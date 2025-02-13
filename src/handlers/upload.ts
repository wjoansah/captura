import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '/opt/nodejs/@aws-sdk/client-s3';
import { fileTypeFromBuffer } from '/opt/nodejs/file-type';

const STAGING_BUCKET_NAME = process.env.STAGING_BUCKET_NAME!;

const s3 = new S3Client({});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const username = event.requestContext.authorizer!.email;
    try {
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'No file content provided' }),
            };
        }

        const fileContent = Buffer.from(event.body, 'base64');

        const fileType = await fileTypeFromBuffer(fileContent);
        if (!fileType || !fileType.mime.startsWith('image/')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Uploaded file is not a valid image' }),
            };
        }

        // Generate a unique file name
        const fileName = `${username}-${Date.now()}.${fileType.ext}`;

        // Upload the image to the staging S3 bucket
        const putObjectParams = {
            Bucket: STAGING_BUCKET_NAME,
            Key: fileName,
            Body: fileContent,
            ContentType: fileType.mime,
        };
        await s3.send(new PutObjectCommand(putObjectParams));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Image uploaded successfully', fileName }),
        };
    } catch (error) {
        console.error('Error uploading image:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error' }),
        };
    }
};
