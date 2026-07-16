import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

export const markdownHtmlPlugins = [rehypeRaw, rehypeSanitize];
