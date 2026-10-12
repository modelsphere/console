import { History, ShieldCheck, Users as UsersIcon } from "lucide-react";
import type { ConsoleModule } from "@/shell";
import { Users } from "@/modules/iam/Users";
import { Roles } from "@/modules/iam/Roles";
import { LoginHistory } from "@/modules/iam/LoginHistory";

export const iamModule: ConsoleModule = {
  id: "iam",
  title: "访问控制",
  basePath: "/iam",
  frame: "flush",
  pages: [
    { path: "users", element: <Users />, permission: "users.view", menu: { label: "用户", icon: UsersIcon } },
    {
      path: "login-history",
      element: <LoginHistory />,
      permission: "loginrecords.view",
      menu: { label: "登录历史", icon: History },
    },
    { path: "roles", element: <Roles />, permission: "roles.view", menu: { label: "角色", icon: ShieldCheck } },
  ],
};
