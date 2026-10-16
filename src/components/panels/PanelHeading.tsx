import { IconButton, Stack, Tooltip, Typography } from "@mui/material";
import HelpOutline from "@mui/icons-material/HelpOutline";

export function HelpTip({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  return (
    <Tooltip title={children} describeChild arrow>
      <IconButton
        // A help control must remain focusable inside a disabled fieldset.
        component="span"
        role="button"
        tabIndex={0}
        size="small"
        aria-label={label + "帮助"}
        sx={{ color: "text.secondary", fontSize: 16 }}
      >
        <HelpOutline fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}

export function PanelHeading({ title, help }: { title: string; help: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography component="h3" variant="body2">
        {title}
      </Typography>
      <HelpTip label={title}>{help}</HelpTip>
    </Stack>
  );
}
